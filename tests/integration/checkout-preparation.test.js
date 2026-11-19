const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { db } = require('../../src/config/postgres');
const {
  prepareCheckout
} = require('../../src/modules/checkout/checkout.service');

async function runTest() {
  let trx;

  try {
    const user = await db('users')
      .select('id')
      .first();

    assert.ok(user, 'An existing PostgreSQL user is required');

    const idempotencyKey = `test-${crypto.randomUUID()}`;

    const cart = {
      currency: 'NGN',
      hasUnavailableItems: false,
      items: [
        {
          productId: crypto.randomUUID(),
          vendorId: crypto.randomUUID(),
          name: 'Test Laptop',
          priceKobo: 15000000,
          currency: 'NGN',
          quantity: 1,
          available: true
        },
        {
          productId: crypto.randomUUID(),
          vendorId: crypto.randomUUID(),
          name: 'Test Mouse',
          priceKobo: 500000,
          currency: 'NGN',
          quantity: 2,
          available: true
        }
      ]
    };

    trx = await db.transaction();

    const checkout = await prepareCheckout({
      userId: user.id,
      idempotencyKey,
      shippingAddress: '123 Test Street, Lagos, Nigeria',
      paymentMethod: 'wallet',
      transaction: trx,
      cartOverride: cart
    });

    assert.equal(checkout.claimed, true);
    assert.equal(checkout.status, 'processing');
    assert.equal(checkout.totalAmountKobo, 16000000);
    assert.equal(checkout.reservations.length, 2);

    console.log('PASS: Checkout prepared successfully');

    const savedRequest = await trx('checkout_requests')
      .where({ id: checkout.checkoutId })
      .first();

    assert.ok(savedRequest);
    assert.equal(savedRequest.order_id, checkout.orderId);

    console.log('PASS: Checkout request linked to order');

    const savedOrder = await trx('orders')
      .where({ id: checkout.orderId })
      .first();

    assert.ok(savedOrder);
    assert.equal(Number(savedOrder.total_amount), 16000000);

    const vendorOrders = await trx('vendor_orders')
      .where({ order_id: checkout.orderId });

    assert.equal(vendorOrders.length, 2);

    console.log('PASS: Customer and vendor orders created');

    const reservationIds = checkout.reservations.map(
      (reservation) => reservation.reservationId
    );

    const savedReservations = await trx('stock_reservations')
      .whereIn('id', reservationIds);

    assert.equal(savedReservations.length, 2);
    assert.ok(
      savedReservations.every(
        (reservation) => reservation.status === 'pending'
      )
    );

    console.log('PASS: Pending stock reservations created');

    const retry = await prepareCheckout({
      userId: user.id,
      idempotencyKey,
      shippingAddress: '123 Test Street, Lagos, Nigeria',
      paymentMethod: 'wallet',
      transaction: trx,
      cartOverride: cart
    });

    assert.equal(retry.claimed, false);
    assert.equal(retry.orderId, checkout.orderId);

    console.log('PASS: Duplicate checkout did not create another order');

    await trx.rollback();
    trx = null;

    const remainingOrder = await db('orders')
      .where({ id: checkout.orderId })
      .first();

    const remainingRequest = await db('checkout_requests')
      .where({ id: checkout.checkoutId })
      .first();

    const remainingReservations = await db('stock_reservations')
      .whereIn('id', reservationIds);

    assert.equal(remainingOrder, undefined);
    assert.equal(remainingRequest, undefined);
    assert.equal(remainingReservations.length, 0);

    console.log('PASS: All test records rolled back');
    console.log('SUCCESS: Checkout preparation integration test passed');

  } finally {
    if (trx && !trx.isCompleted()) {
      await trx.rollback();
    }

    await db.destroy();
  }
}

test('checkout preparation integration', async () => {
  await runTest();
}, 60000);
