/** @jest-environment node */

jest.setTimeout(60000);

const crypto = require('node:crypto');
const mongoose = require('mongoose');

const env = require('../../src/config/env');
const { db } = require('../../src/config/postgres');
const { redis } = require('../../src/config/redis');

const Product = require('../../src/modules/catalogue/product.model');

const {
  prepareCheckout
} = require('../../src/modules/checkout/checkout.service');

const {
  reserveOrderStock
} = require('../../src/modules/checkout/checkout-stock.coordinator');

const {
  initializePaystackCheckout
} = require('../../src/modules/checkout/checkout-paystack.service');

const {
  settlePaystackOrder
} = require('../../src/modules/checkout/checkout-paystack-settlement.service');

const {
  completePaystackCheckout
} = require('../../src/modules/checkout/checkout-completion.service');

const StockReservation = require(
  '../../src/modules/checkout/stock-reservation.model'
);

const {
  getOrderReservations
} = require('../../src/modules/checkout/checkout-stock.repository');

const makeId = () => crypto.randomUUID();

describe('Paystack order initialization integration', () => {
  let userId;
  let productId;
  let orderId;
  let originalFetch;

  beforeAll(async () => {
    if (
      env.NODE_ENV !== 'test' ||
      env.POSTGRES_DB !== 'kobomarket_test' ||
      new URL(env.MONGODB_URI).pathname !== '/kobomarket_test' ||
      redis.options.db !== 15
    ) {
      throw new Error('Unsafe test database configuration');
    }

    if (!env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
      throw new Error('Paystack test key required');
    }

    await mongoose.connect(env.MONGODB_URI, {
      directConnection: true,
      serverSelectionTimeoutMS: 5000
    });

    originalFetch = global.fetch;

    userId = makeId();
    productId = makeId();

    await db('users').insert({ id: userId });

    await Product.create({
      productId,
      vendorId: makeId(),
      storeId: makeId(),
      categoryId: makeId(),
      name: 'Paystack Checkout Test Product',
      slug: `paystack-checkout-${makeId()}`,
      description: 'Isolated Paystack initialization test',
      priceKobo: 10000,
      currency: 'NGN',
      stockQuantity: 100,
      status: 'active'
    });
  });

  afterAll(async () => {
    global.fetch = originalFetch;

    // Preserve test payment records for reconciliation.
    // Do not delete historical financial records.
    try {
      await mongoose.disconnect();
    } finally {
      try {
        await redis.quit();
      } finally {
        await db.destroy();
      }
    }
  });

  const createCheckout = async (paymentMethod) => {
    const product = await Product.findOne({ productId });

    const prepared = await prepareCheckout({
      userId,
      idempotencyKey: `paystack-test-${makeId()}`,
      shippingAddress: '123 Test Street, Lagos, Nigeria',
      paymentMethod,
      cartOverride: {
        currency: 'NGN',
        hasUnavailableItems: false,
        items: [{
          productId,
          vendorId: product.vendorId,
          name: product.name,
          priceKobo: product.priceKobo,
          currency: 'NGN',
          quantity: 1,
          available: true
        }]
      }
    });

    const reserved = await reserveOrderStock(prepared.orderId);

    expect(reserved.status).toBe('stock_reserved');

    return prepared.orderId;
  };

  test('initializes once and reuses the same pending payment', async () => {
    orderId = await createCheckout('paystack');

    const authorizationUrl =
      'https://checkout.paystack.com/mock-test-authorization';

    global.fetch = jest.fn(async (_url, options) => {
      const request = JSON.parse(options.body);

      expect(request.amount).toBe(10000);
      expect(request.currency).toBe('NGN');
      expect(request.metadata.orderId).toBe(orderId);

      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: true,
          data: {
            reference: request.reference,
            authorization_url: authorizationUrl,
            access_code: 'mock-access-code'
          }
        })
      };
    });

    const first = await initializePaystackCheckout({
      userId,
      orderId,
      email: 'customer@example.com'
    });

    expect(first.reused).toBe(false);
    expect(first.authorizationUrl).toBe(authorizationUrl);
    expect(first.amountKobo).toBe('10000');

    const second = await initializePaystackCheckout({
      userId,
      orderId,
      email: 'customer@example.com'
    });

    expect(second.reused).toBe(true);
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.reference).toBe(first.reference);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const payments = await db('payments')
      .where({
        order_id: orderId,
        payment_type: 'order'
      });

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('pending');
    expect(payments[0].provider).toBe('paystack');

    const escrows = await db('escrows')
      .where({ payment_id: first.paymentId });

    expect(escrows).toHaveLength(0);
  });

  test('rejects Paystack payment for a wallet order', async () => {
    const walletOrderId = await createCheckout('wallet');

    global.fetch = jest.fn();

    await expect(
      initializePaystackCheckout({
        userId,
        orderId: walletOrderId,
        email: 'customer@example.com'
      })
    ).rejects.toThrow(
      'Order was not prepared for Paystack payment'
    );

    expect(global.fetch).not.toHaveBeenCalled();

    const payments = await db('payments')
      .where({ order_id: walletOrderId });

    expect(payments).toHaveLength(0);
  });

  test('settles once, posts balanced ledger, and holds vendor escrow', async () => {
    const settlementOrderId = await createCheckout('paystack');

    const authorizationUrl =
      'https://checkout.paystack.com/mock-settlement-test';

    global.fetch = jest.fn(async (url, options) => {
      if (url.endsWith('/transaction/initialize')) {
        const request = JSON.parse(options.body);

        return {
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference: request.reference,
              authorization_url: authorizationUrl
            }
          })
        };
      }

      if (url.includes('/transaction/verify/')) {
        const reference = decodeURIComponent(
          url.split('/').pop()
        );

        return {
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference,
              amount: 10000,
              currency: 'NGN',
              status: 'success'
            }
          })
        };
      }

      throw new Error(`Unexpected Paystack request: ${url}`);
    });

    const initialized = await initializePaystackCheckout({
      userId,
      orderId: settlementOrderId,
      email: 'customer@example.com'
    });

    const first = await settlePaystackOrder({
      userId,
      orderId: settlementOrderId,
      reference: initialized.reference
    });

    expect(first.status).toBe('successful');
    expect(first.duplicate).toBe(false);
    expect(first.amountKobo).toBe('10000');

    const second = await settlePaystackOrder({
      userId,
      orderId: settlementOrderId,
      reference: initialized.reference
    });

    expect(second.status).toBe('successful');
    expect(second.duplicate).toBe(true);
    expect(second.paymentId).toBe(first.paymentId);

    const order = await db('orders')
      .where({ id: settlementOrderId })
      .first();

    expect(order.status).toBe('confirmed');
    expect(order.payment_method).toBe('paystack');

    const checkout = await db('checkout_requests')
      .where({ order_id: settlementOrderId })
      .first();

    expect(checkout.status).toBe('completed');

    const payment = await db('payments')
      .where({ id: first.paymentId })
      .first();

    expect(payment.status).toBe('successful');
    expect(payment.provider).toBe('paystack');

    const ledgerTransactions = await db('ledger_transactions')
      .where({
        reference_type: 'payment',
        reference_id: first.paymentId
      });

    expect(ledgerTransactions).toHaveLength(1);
    expect(ledgerTransactions[0].status).toBe('posted');

    const entries = await db('ledger_entries')
      .where({
        transaction_id: ledgerTransactions[0].id
      });

    expect(entries).toHaveLength(2);

    const debits = entries
      .filter(entry => entry.entry_type === 'debit')
      .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);

    const credits = entries
      .filter(entry => entry.entry_type === 'credit')
      .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);

    expect(debits).toBe(10000n);
    expect(credits).toBe(10000n);

    const accountIds = entries.map(entry => entry.account_id);

    const accounts = await db('financial_accounts')
      .whereIn('id', accountIds);

    const accountCodes = new Map(
      accounts.map(account => [account.id, account.account_code])
    );

    expect(
      entries.some(entry =>
        entry.entry_type === 'debit' &&
        accountCodes.get(entry.account_id) === 'PAYSTACK_CLEARING'
      )
    ).toBe(true);

    expect(
      entries.some(entry =>
        entry.entry_type === 'credit' &&
        accountCodes.get(entry.account_id) === 'ESCROW_LIABILITY'
      )
    ).toBe(true);

    const vendorOrders = await db('vendor_orders')
      .where({ order_id: settlementOrderId });

    expect(vendorOrders.length).toBeGreaterThan(0);
    expect(
      vendorOrders.every(item => item.status === 'confirmed')
    ).toBe(true);

    const escrows = await db('escrows')
      .where({ payment_id: first.paymentId });

    expect(escrows).toHaveLength(vendorOrders.length);
    expect(escrows.every(item => item.status === 'held')).toBe(true);

    const escrowTotal = escrows.reduce(
      (sum, item) => sum + BigInt(item.amount),
      0n
    );

    expect(escrowTotal).toBe(10000n);

    const payments = await db('payments')
      .where({
        order_id: settlementOrderId,
        payment_type: 'order'
      });

    expect(payments).toHaveLength(1);
  });

  test('completes Paystack checkout and commits stock exactly once', async () => {
    const completionOrderId = await createCheckout('paystack');

    const reservations = await getOrderReservations(completionOrderId);

    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe('reserved');

    const reservedStock = await Product.findOne({ productId });
    const stockAfterReservation = reservedStock.stockQuantity;

    global.fetch = jest.fn(async (url, options) => {
      if (url.endsWith('/transaction/initialize')) {
        const request = JSON.parse(options.body);

        return {
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference: request.reference,
              authorization_url:
                'https://checkout.paystack.com/mock-completion-test'
            }
          })
        };
      }

      if (url.includes('/transaction/verify/')) {
        const reference = decodeURIComponent(url.split('/').pop());

        return {
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference,
              amount: 10000,
              currency: 'NGN',
              status: 'success'
            }
          })
        };
      }

      throw new Error(`Unexpected Paystack request: ${url}`);
    });

    const initialized = await initializePaystackCheckout({
      userId,
      orderId: completionOrderId,
      email: 'customer@example.com'
    });

    const first = await completePaystackCheckout({
      userId,
      orderId: completionOrderId,
      reference: initialized.reference
    });

    expect(first.status).toBe('successful');
    expect(first.duplicate).toBe(false);
    expect(first.stockStatus).toBe('stock_committed');
    expect(first.stockReservations).toBe(1);

    const postgresReservations = await getOrderReservations(
      completionOrderId
    );

    expect(postgresReservations).toHaveLength(1);
    expect(postgresReservations[0].status).toBe('committed');

    const mongoReservation = await StockReservation.findOne({
      reservationId: reservations[0].reservationId
    });

    expect(mongoReservation).not.toBeNull();
    expect(mongoReservation.status).toBe('committed');

    const stockAfterCompletion = await Product.findOne({ productId });

    expect(stockAfterCompletion.stockQuantity).toBe(
      stockAfterReservation
    );

    const second = await completePaystackCheckout({
      userId,
      orderId: completionOrderId,
      reference: initialized.reference
    });

    expect(second.status).toBe('successful');
    expect(second.duplicate).toBe(true);
    expect(second.stockStatus).toBe('stock_committed');

    const stockAfterRetry = await Product.findOne({ productId });

    expect(stockAfterRetry.stockQuantity).toBe(
      stockAfterReservation
    );

    const ledgerTransactions = await db('ledger_transactions')
      .where({
        reference_type: 'payment',
        reference_id: first.paymentId
      });

    expect(ledgerTransactions).toHaveLength(1);

    const escrows = await db('escrows')
      .where({ payment_id: first.paymentId });

    expect(escrows).toHaveLength(1);
    expect(escrows[0].status).toBe('held');
    expect(String(escrows[0].amount)).toBe('10000');

    const payments = await db('payments')
      .where({
        order_id: completionOrderId,
        payment_type: 'order'
      });

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('successful');

    const order = await db('orders')
      .where({ id: completionOrderId })
      .first();

    expect(order.status).toBe('confirmed');

    const checkout = await db('checkout_requests')
      .where({ order_id: completionOrderId })
      .first();

    expect(checkout.status).toBe('completed');
  });

  test('rejects incorrect Paystack amounts without settlement', async () => {
    const testOrderId = await createCheckout('paystack');

    global.fetch = jest.fn(async (url, options) => {
      if (url.endsWith('/transaction/initialize')) {
        const request = JSON.parse(options.body);

        return {
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference: request.reference,
              authorization_url:
                'https://checkout.paystack.com/mock-amount-test'
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          status: true,
          data: {
            reference: decodeURIComponent(url.split('/').pop()),
            amount: 5000,
            currency: 'NGN',
            status: 'success'
          }
        })
      };
    });

    const initialized = await initializePaystackCheckout({
      userId,
      orderId: testOrderId,
      email: 'customer@example.com'
    });

    await expect(
      completePaystackCheckout({
        userId,
        orderId: testOrderId,
        reference: initialized.reference
      })
    ).rejects.toThrow(
      'Paystack transaction details do not match our payment'
    );

    const payment = await db('payments')
      .where({ id: initialized.paymentId })
      .first();

    expect(payment.status).toBe('pending');

    const escrows = await db('escrows')
      .where({ payment_id: initialized.paymentId });

    expect(escrows).toHaveLength(0);

    const ledger = await db('ledger_transactions')
      .where({
        reference_type: 'payment',
        reference_id: initialized.paymentId
      });

    expect(ledger).toHaveLength(0);
  });

  test('does not settle an order with expired stock reservations', async () => {
    const testOrderId = await createCheckout('paystack');

    global.fetch = jest.fn(async (url, options) => {
      if (url.endsWith('/transaction/initialize')) {
        const request = JSON.parse(options.body);

        return {
          ok: true,
          json: async () => ({
            status: true,
            data: {
              reference: request.reference,
              authorization_url:
                'https://checkout.paystack.com/mock-expiry-test'
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          status: true,
          data: {
            reference: decodeURIComponent(url.split('/').pop()),
            amount: 10000,
            currency: 'NGN',
            status: 'success'
          }
        })
      };
    });

    const initialized = await initializePaystackCheckout({
      userId,
      orderId: testOrderId,
      email: 'customer@example.com'
    });

    const reservations = await getOrderReservations(testOrderId);

    expect(reservations).toHaveLength(1);

    // Expire only the new test reservation, never development records.
    await db('stock_reservations')
      .where({ id: reservations[0].reservationId })
      .update({
        expires_at: new Date(Date.now() - 60000)
      });

    const result = await completePaystackCheckout({
      userId,
      orderId: testOrderId,
      reference: initialized.reference
    });

    expect(result.providerStatus).toBe('success');
    expect(result.settlementStatus).toBe('reconciliation_required');
    expect(result.stockStatus).toBe('not_committed');

    const payment = await db('payments')
      .where({ id: initialized.paymentId })
      .first();

    expect(payment.status).toBe('pending');

    const escrows = await db('escrows')
      .where({ payment_id: initialized.paymentId });

    expect(escrows).toHaveLength(0);

    const ledger = await db('ledger_transactions')
      .where({
        reference_type: 'payment',
        reference_id: initialized.paymentId
      });

    expect(ledger).toHaveLength(0);
  });
});
