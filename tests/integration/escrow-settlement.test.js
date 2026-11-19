/** @jest-environment node */

const crypto = require('node:crypto');

const { db } = require('../../src/config/postgres');
const Vendor = require('../../src/modules/vendors/vendor.model');
const ledgerService = require('../../src/modules/wallets/ledger.service');
const { releaseEscrow } = require(
  '../../src/modules/escrow/escrow.service'
);

jest.setTimeout(30000);

describe('Escrow financial settlement', () => {
  let customerId;
  let vendorUserId;
  let adminId;
  let vendorId;
  let vendorWalletId;
  let orderId;
  let vendorOrderId;
  let paymentId;
  let escrowId;

  beforeAll(async () => {
    customerId = crypto.randomUUID();
    vendorUserId = crypto.randomUUID();
    adminId = crypto.randomUUID();
    vendorId = crypto.randomUUID();

    await db('users').insert([
      { id: customerId },
      { id: vendorUserId },
      { id: adminId }
    ]);

    const [wallet] = await db('wallets')
      .insert({
        user_id: vendorUserId,
        wallet_type: 'vendor',
        currency: 'NGN',
        status: 'active'
      })
      .returning('*');

    vendorWalletId = wallet.id;

    await db('wallet_balances').insert({
      wallet_id: vendorWalletId,
      available_balance: 0,
      locked_balance: 0
    });

    const [order] = await db('orders')
      .insert({
        order_number: `KM-ESCROW-${crypto.randomUUID()}`,
        user_id: customerId,
        currency: 'NGN',
        status: 'confirmed',
        payment_method: 'wallet',
        subtotal: 10000,
        shipping_fee: 0,
        discount_amount: 0,
        total_amount: 10000,
        shipping_address: JSON.stringify({
          address: 'Escrow integration test'
        })
      })
      .returning('*');

    orderId = order.id;

    const [vendorOrder] = await db('vendor_orders')
      .insert({
        order_id: orderId,
        vendor_id: vendorId,
        status: 'delivered',
        currency: 'NGN',
        subtotal: 10000,
        shipping_fee: 0,
        total_amount: 10000
      })
      .returning('*');

    vendorOrderId = vendorOrder.id;

    const [payment] = await db('payments')
      .insert({
        order_id: orderId,
        provider: 'wallet',
        payment_method: 'wallet',
        currency: 'NGN',
        amount: 10000,
        status: 'successful',
        idempotency_key: `escrow-test-${crypto.randomUUID()}`
      })
      .returning('*');

    paymentId = payment.id;

    const [escrow] = await db('escrows')
      .insert({
        vendor_order_id: vendorOrderId,
        payment_id: paymentId,
        currency: 'NGN',
        amount: 10000,
        released_amount: 0,
        refunded_amount: 0,
        status: 'held'
      })
      .returning('*');

    escrowId = escrow.id;

    jest.spyOn(Vendor, 'findOne').mockReturnValue({
      lean: async () => ({
        vendorId,
        userId: vendorUserId,
        status: 'approved'
      })
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    // Posted ledger transactions and their referenced financial
    // records must remain immutable.
    await db.destroy();
  });

  test('releases escrow into the vendor wallet', async () => {
    const result = await releaseEscrow({
      vendorOrderId,
      initiatedBy: adminId
    });

    expect(result.status).toBe('released');
    expect(result.duplicate).toBe(false);
    expect(result.amountReleasedKobo).toBe('10000');

    const walletBalance = await db('wallet_balances')
      .where({ wallet_id: vendorWalletId })
      .first();

    expect(String(walletBalance.available_balance)).toBe('10000');

    const escrow = await db('escrows')
      .where({ id: escrowId })
      .first();

    expect(escrow.status).toBe('released');
    expect(String(escrow.released_amount)).toBe('10000');
  });

  test('does not credit the vendor twice', async () => {
    const result = await releaseEscrow({
      vendorOrderId,
      initiatedBy: adminId
    });

    expect(result.duplicate).toBe(true);

    const balance = await db('wallet_balances')
      .where({ wallet_id: vendorWalletId })
      .first();

    expect(String(balance.available_balance)).toBe('10000');

    const transactions = await db('ledger_transactions')
      .where({
        reference_type: 'escrow',
        reference_id: escrowId,
        transaction_type: 'escrow_release'
      });

    expect(transactions).toHaveLength(1);
  });

  test('concurrent requests cannot release escrow twice', async () => {
    // A separate customer order is required because the database
    // permits only one vendor order per order/vendor combination.
    const [concurrentOrder] = await db('orders')
      .insert({
        order_number: `KM-CONCURRENT-${crypto.randomUUID()}`,
        user_id: customerId,
        currency: 'NGN',
        status: 'confirmed',
        payment_method: 'wallet',
        subtotal: 10000,
        shipping_fee: 0,
        discount_amount: 0,
        total_amount: 10000,
        shipping_address: JSON.stringify({
          address: 'Concurrency integration test'
        })
      })
      .returning('*');

    const [concurrentPayment] = await db('payments')
      .insert({
        order_id: concurrentOrder.id,
        provider: 'wallet',
        payment_method: 'wallet',
        currency: 'NGN',
        amount: 10000,
        status: 'successful',
        idempotency_key: `concurrent-${crypto.randomUUID()}`
      })
      .returning('*');

    const [newVendorOrder] = await db('vendor_orders')
      .insert({
        order_id: concurrentOrder.id,
        vendor_id: vendorId,
        status: 'delivered',
        currency: 'NGN',
        subtotal: 10000,
        shipping_fee: 0,
        total_amount: 10000
      })
      .returning('*');

    const [newEscrow] = await db('escrows')
      .insert({
        vendor_order_id: newVendorOrder.id,
        payment_id: concurrentPayment.id,
        currency: 'NGN',
        amount: 10000,
        released_amount: 0,
        refunded_amount: 0,
        status: 'held'
      })
      .returning('*');

    const balanceBefore = await db('wallet_balances')
      .where({ wallet_id: vendorWalletId })
      .first();

    const results = await Promise.allSettled([
      releaseEscrow({
        vendorOrderId: newVendorOrder.id,
        initiatedBy: adminId
      }),
      releaseEscrow({
        vendorOrderId: newVendorOrder.id,
        initiatedBy: adminId
      })
    ]);

    const successful = results.filter(
      (result) =>
        result.status === 'fulfilled' &&
        result.value.duplicate === false
    );

    expect(successful).toHaveLength(1);

    const transactions = await db('ledger_transactions')
      .where({
        transaction_type: 'escrow_release',
        reference_type: 'escrow',
        reference_id: newEscrow.id,
        status: 'posted'
      });

    expect(transactions).toHaveLength(1);

    const balanceAfter = await db('wallet_balances')
      .where({ wallet_id: vendorWalletId })
      .first();

    expect(
      BigInt(balanceAfter.available_balance) -
      BigInt(balanceBefore.available_balance)
    ).toBe(10000n);
  });



  // Create an independent, fully funded test fixture.
  // Each scenario gets its own order, payment, vendor order and escrow.
  const createHeldEscrowFixture = async () => {
    const [order] = await db('orders').insert({
      order_number: `KM-SAFETY-${crypto.randomUUID()}`,
      user_id: customerId,
      currency: 'NGN',
      status: 'confirmed',
      payment_method: 'wallet',
      subtotal: 10000,
      shipping_fee: 0,
      discount_amount: 0,
      total_amount: 10000,
      shipping_address: JSON.stringify({
        address: 'Escrow safety integration test'
      })
    }).returning('*');

    const [payment] = await db('payments').insert({
      order_id: order.id,
      provider: 'wallet',
      payment_method: 'wallet',
      currency: 'NGN',
      amount: 10000,
      status: 'successful',
      idempotency_key: `safety-${crypto.randomUUID()}`
    }).returning('*');

    const [vendorOrder] = await db('vendor_orders').insert({
      order_id: order.id,
      vendor_id: vendorId,
      status: 'delivered',
      currency: 'NGN',
      subtotal: 10000,
      shipping_fee: 0,
      total_amount: 10000
    }).returning('*');

    const [escrow] = await db('escrows').insert({
      vendor_order_id: vendorOrder.id,
      payment_id: payment.id,
      currency: 'NGN',
      amount: 10000,
      released_amount: 0,
      refunded_amount: 0,
      status: 'held'
    }).returning('*');

    return { order, payment, vendorOrder, escrow };
  };

  test.each(['open', 'under_review'])(
    'blocks escrow release when dispute status is %s',
    async (disputeStatus) => {
      const fixture = await createHeldEscrowFixture();

      await db('disputes').insert({
        vendor_order_id: fixture.vendorOrder.id,
        opened_by: customerId,
        reason: 'item_not_received',
        description: 'Dispute protection integration test',
        status: disputeStatus
      });

      const balanceBefore = await db('wallet_balances')
        .where({ wallet_id: vendorWalletId })
        .first();

      await expect(
        releaseEscrow({
          vendorOrderId: fixture.vendorOrder.id,
          initiatedBy: adminId
        })
      ).rejects.toThrow(
        'Escrow cannot be released while a dispute is active'
      );

      const escrowAfter = await db('escrows')
        .where({ id: fixture.escrow.id })
        .first();

      const balanceAfter = await db('wallet_balances')
        .where({ wallet_id: vendorWalletId })
        .first();

      const ledgerRows = await db('ledger_transactions')
        .where({
          reference_type: 'escrow',
          reference_id: fixture.escrow.id,
          transaction_type: 'escrow_release'
        });

      expect(escrowAfter.status).toBe('held');
      expect(String(escrowAfter.released_amount)).toBe('0');
      expect(String(escrowAfter.refunded_amount)).toBe('0');

      expect(String(balanceAfter.available_balance))
        .toBe(String(balanceBefore.available_balance));

      expect(ledgerRows).toHaveLength(0);
    }
  );

  test('rolls back escrow release when ledger posting fails', async () => {
    const fixture = await createHeldEscrowFixture();

    const balanceBefore = await db('wallet_balances')
      .where({ wallet_id: vendorWalletId })
      .first();

    const failure = new Error('SIMULATED_ESCROW_LEDGER_FAILURE');

    const ledgerSpy = jest.spyOn(ledgerService, 'postTransaction')
      .mockRejectedValueOnce(failure);

    try {
      await expect(
        releaseEscrow({
          vendorOrderId: fixture.vendorOrder.id,
          initiatedBy: adminId
        })
      ).rejects.toThrow('SIMULATED_ESCROW_LEDGER_FAILURE');
    } finally {
      ledgerSpy.mockRestore();
    }

    const escrowAfter = await db('escrows')
      .where({ id: fixture.escrow.id })
      .first();

    const balanceAfter = await db('wallet_balances')
      .where({ wallet_id: vendorWalletId })
      .first();

    const ledgerRows = await db('ledger_transactions')
      .where({
        reference_type: 'escrow',
        reference_id: fixture.escrow.id,
        transaction_type: 'escrow_release'
      });

    expect(escrowAfter.status).toBe('held');
    expect(String(escrowAfter.released_amount)).toBe('0');
    expect(String(escrowAfter.refunded_amount)).toBe('0');

    expect(String(balanceAfter.available_balance))
      .toBe(String(balanceBefore.available_balance));

    expect(ledgerRows).toHaveLength(0);
  });

});
