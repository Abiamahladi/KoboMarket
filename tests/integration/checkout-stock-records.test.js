const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { db } = require('../../src/config/postgres');
const {
  createOrder
} = require('../../src/modules/checkout/checkout.repository');
const {
  createPendingReservations
} = require('../../src/modules/checkout/checkout-stock.repository');

async function runTest() {
  let trx;

  try {
    const user = await db('users').select('id').first();

    assert.ok(user, 'An existing PostgreSQL user is required');

    const cart = {
      currency: 'NGN',
      hasUnavailableItems: false,
      items: [
        {
          productId: crypto.randomUUID(),
          vendorId: crypto.randomUUID(),
          name: 'Test Keyboard',
          priceKobo: 2500000,
          currency: 'NGN',
          quantity: 2,
          available: true
        },
        {
          productId: crypto.randomUUID(),
          vendorId: crypto.randomUUID(),
          name: 'Test Monitor',
          priceKobo: 7500000,
          currency: 'NGN',
          quantity: 1,
          available: true
        }
      ]
    };

    trx = await db.transaction();

    const order = await createOrder({
      paymentMethod: 'wallet',
      userId: user.id,
      cart,
      shippingAddress: '123 Test Street, Lagos, Nigeria',
      transaction: trx
    });

    const reservations = await createPendingReservations({
      orderItems: order.orderItems,
      transaction: trx
    });

    assert.equal(order.orderItems.length, 2);
    assert.equal(reservations.length, 2);
    assert.equal(order.totalAmountKobo, 12500000);

    console.log('PASS: Order and two order items created');

    const savedReservations = await trx('stock_reservations')
      .whereIn(
        'id',
        reservations.map((item) => item.reservationId)
      );

    assert.equal(savedReservations.length, 2);

    for (const reservation of reservations) {
      const saved = savedReservations.find(
        (item) => item.id === reservation.reservationId
      );

      assert.ok(saved);
      assert.equal(saved.status, 'pending');
      assert.equal(saved.order_item_id, reservation.orderItemId);
      assert.equal(saved.product_id, reservation.productId);
      assert.equal(saved.quantity, reservation.quantity);
      assert.ok(new Date(saved.expires_at) > new Date());
    }

    console.log('PASS: Two pending stock reservations saved');
    console.log('PASS: Reservation IDs and order item IDs match');

    await trx.rollback();
    trx = null;

    const remainingOrder = await db('orders')
      .where({ id: order.orderId })
      .first();

    const remainingReservations = await db('stock_reservations')
      .whereIn(
        'id',
        reservations.map((item) => item.reservationId)
      );

    assert.equal(remainingOrder, undefined);
    assert.equal(remainingReservations.length, 0);

    console.log('PASS: Order and reservations rolled back');
    console.log('SUCCESS: Checkout stock records integration test passed');

  } finally {
    if (trx && !trx.isCompleted()) {
      await trx.rollback();
    }

    await db.destroy();
  }
}

test('checkout stock records integration', async () => {
  await runTest();
}, 60000);
