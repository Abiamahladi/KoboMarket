/** @jest-environment node */

const crypto = require('node:crypto');

const { db } = require('../../src/config/postgres');
const {
  payWithWallet
} = require('../../src/modules/checkout/checkout-wallet-payment.service');

jest.setTimeout(30000);

describe('Wallet checkout protection', () => {
  let userId;
  let walletId;
  let orderId;

  beforeAll(async () => {
    const [user] = await db('users')
      .insert({
        id: crypto.randomUUID()
      })
      .returning('id');

    userId = user.id;

    // Create an isolated wallet with zero balance.
    const [wallet] = await db('wallets')
      .insert({
        user_id: userId,
        wallet_type: 'customer',
        currency: 'NGN',
        status: 'active'
      })
      .returning('*');

    walletId = wallet.id;

    await db('wallet_balances').insert({
      wallet_id: walletId,
      available_balance: 0,
      locked_balance: 0
    });

    const [order] = await db('orders')
      .insert({
        order_number: `KM-TEST-${crypto.randomUUID()}`,
        user_id: userId,
        currency: 'NGN',
        status: 'pending',
        payment_method: 'wallet',
        subtotal: 10000,
        shipping_fee: 0,
        discount_amount: 0,
        total_amount: 10000,
        shipping_address: JSON.stringify({
          address: 'Integration test only'
        })
      })
      .returning('*');

    orderId = order.id;

    await db('checkout_requests').insert({
      user_id: userId,
      idempotency_key: `wallet-test-${crypto.randomUUID()}`,
      request_hash: crypto
        .createHash('sha256')
        .update(crypto.randomUUID())
        .digest('hex'),
      order_id: orderId,
      status: 'processing'
    });
  });

  afterAll(async () => {
    if (orderId) {
      await db('checkout_requests')
        .where({ order_id: orderId })
        .del();

      await db('orders')
        .where({ id: orderId })
        .del();
    }

    if (walletId) {
      await db('wallet_balances')
        .where({ wallet_id: walletId })
        .del();

      await db('wallets')
        .where({ id: walletId })
        .del();
    }

    if (userId) {
      await db('users')
        .where({ id: userId })
        .del();
    }

    await db.destroy();
  });

  test('rejects missing payment details', async () => {
    await expect(
      payWithWallet({
        userId,
        orderId: null,
        walletId
      })
    ).rejects.toThrow(
      'User ID, order ID and wallet ID are required'
    );
  });

  test('rejects an order belonging to another customer', async () => {
    await expect(
      payWithWallet({
        userId: crypto.randomUUID(),
        orderId,
        walletId
      })
    ).rejects.toThrow('Order not found');
  });

  test('rejects payment without reserved stock', async () => {
    await expect(
      payWithWallet({
        userId,
        orderId,
        walletId
      })
    ).rejects.toThrow(
      'Order stock reservations are incomplete'
    );
  });

  test('does not debit wallet after rejected checkout', async () => {
    const balance = await db('wallet_balances')
      .where({ wallet_id: walletId })
      .first();

    expect(String(balance.available_balance)).toBe('0');

    const payments = await db('payments')
      .where({ order_id: orderId });

    expect(payments).toHaveLength(0);
  });
});
