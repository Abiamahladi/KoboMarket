const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { db } = require('../../src/config/postgres');
const { createOrder } = require('../../src/modules/checkout/checkout.repository');

const runTest = async () => {
  let trx;

  try {
    // Find an existing PostgreSQL user for the foreign key.
    const user = await db('users')
      .select('id')
      .first();

    assert.ok(user, 'A PostgreSQL test user is required');

    // Generate temporary vendor and product IDs.
    const vendorA = crypto.randomUUID();
    const vendorB = crypto.randomUUID();

    const productA = crypto.randomUUID();
    const productB = crypto.randomUUID();

    // Create a test cart containing two vendors.
    const cart = {
      currency: 'NGN',
      hasUnavailableItems: false,
      items: [
        {
          productId: productA,
          vendorId: vendorA,
          name: 'Test Laptop',
          priceKobo: 15000000,
          currency: 'NGN',
          quantity: 1,
          available: true
        },
        {
          productId: productB,
          vendorId: vendorB,
          name: 'Test Mouse',
          priceKobo: 500000,
          currency: 'NGN',
          quantity: 2,
          available: true
        }
      ]
    };

    // Begin a transaction controlled by the test.
    trx = await db.transaction();

    const result = await createOrder({
      paymentMethod: 'wallet',
      userId: user.id,
      cart,
      shippingAddress: '123 Integration Test Street, Lagos, Nigeria',
      transaction: trx
    });

    assert.equal(result.status, 'pending');
    assert.equal(result.currency, 'NGN');
    assert.equal(result.subtotalKobo, 16000000);
    assert.equal(result.totalAmountKobo, 16000000);
    assert.equal(result.orderItems.length, 2);

    // Verify customer order.
    const order = await trx('orders')
      .where({ id: result.orderId })
      .first();

    assert.ok(order, 'Customer order was not created');
    assert.equal(order.user_id, user.id);
    assert.equal(Number(order.total_amount), 16000000);

    // Verify vendor grouping.
    const vendorOrders = await trx('vendor_orders')
      .where({ order_id: result.orderId });

    assert.equal(vendorOrders.length, 2);

    // Verify the order items.
    const orderItemIds = result.orderItems.map(
      (item) => item.orderItemId
    );

    const orderItems = await trx('order_items')
      .whereIn('id', orderItemIds);

    assert.equal(orderItems.length, 2);

    console.log('PASS: Customer order created');
    console.log('PASS: Two vendor orders created');
    console.log('PASS: Two order items created');
    console.log('PASS: Order totals calculated correctly');

    // Roll back all records created by this test.
    await trx.rollback();
    trx = null;

    // Verify the order does not exist after rollback.
    const persistedOrder = await db('orders')
      .where({ id: result.orderId })
      .first();

    assert.equal(persistedOrder, undefined);

    console.log('PASS: Test transaction rolled back');
    console.log('SUCCESS: PostgreSQL checkout order integration test passed');

  } finally {
    if (trx && !trx.isCompleted()) {
      await trx.rollback();
    }

    await db.destroy();
  }
};

test('checkout order integration', async () => {
  await runTest();
}, 60000);
