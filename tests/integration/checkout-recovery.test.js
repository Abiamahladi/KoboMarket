/** @jest-environment node */

jest.setTimeout(30000);

const crypto = require('node:crypto');
const { db } = require('../../src/config/postgres');

const {
  reconcileReleasedCheckout
} = require('../../src/modules/checkout/checkout-recovery.service');

const makeId = () => crypto.randomUUID();

describe('Checkout Recovery', () => {
  const createdOrders = [];

  const createTestOrder = async (reservationStatus = 'released') => {
    const user = await db('users').select('id').first();

    if (!user) {
      throw new Error('A PostgreSQL test user is required');
    }

    const userId = user.id;
    const orderId = makeId();
    const vendorOrderId = makeId();
    const orderItemId = makeId();
    const reservationId = makeId();
    const checkoutId = makeId();

    await db.transaction(async (trx) => {
      await trx('orders').insert({
        id: orderId,
        order_number: `TEST-${Date.now()}-${makeId().slice(0, 8)}`,
        user_id: userId,
        currency: 'NGN',
        status: 'pending',
        subtotal: 100000,
        shipping_fee: 0,
        discount_amount: 0,
        total_amount: 100000,
        shipping_address: '123 Test Street, Lagos, Nigeria'
      });

      await trx('vendor_orders').insert({
        id: vendorOrderId,
        order_id: orderId,
        vendor_id: makeId(),
        status: 'pending',
        currency: 'NGN',
        subtotal: 100000,
        shipping_fee: 0,
        total_amount: 100000
      });

      await trx('order_items').insert({
        id: orderItemId,
        vendor_order_id: vendorOrderId,
        product_id: makeId(),
        product_name: 'Recovery Test Product',
        product_sku: `SKU-${makeId().slice(0, 8)}`,
        quantity: 1,
        unit_price: 100000,
        line_total: 100000
      });

      await trx('stock_reservations').insert({
        id: reservationId,
        order_item_id: orderItemId,
        product_id: makeId(),
        quantity: 1,
        status: reservationStatus,
        expires_at: new Date(Date.now() + 1800000),
        released_at: reservationStatus === 'released'
          ? new Date()
          : null
      });

      await trx('checkout_requests').insert({
        id: checkoutId,
        user_id: userId,
        idempotency_key: `recovery-${makeId()}`,
        request_hash: crypto
          .createHash('sha256')
          .update(makeId())
          .digest('hex'),
        order_id: orderId,
        status: 'processing'
      });
    });

    createdOrders.push(orderId);
    return { orderId, checkoutId };
  };

  afterAll(async () => {
    try {
      for (const orderId of createdOrders) {
        await db.transaction(async (trx) => {
          await trx('checkout_requests')
            .where({ order_id: orderId })
            .delete();

          await trx('stock_reservations')
            .whereIn('order_item_id', function () {
              this.select('oi.id')
                .from('order_items as oi')
                .join(
                  'vendor_orders as vo',
                  'oi.vendor_order_id',
                  'vo.id'
                )
                .where('vo.order_id', orderId);
            })
            .delete();

          await trx('order_items')
            .whereIn('vendor_order_id', function () {
              this.select('id')
                .from('vendor_orders')
                .where({ order_id: orderId });
            })
            .delete();

          await trx('vendor_orders')
            .where({ order_id: orderId })
            .delete();

          await trx('orders')
            .where({ id: orderId })
            .delete();
        });
      }
    } finally {
      await db.destroy();
    }
  });

  test('cancels checkout after stock is released', async () => {
    const { orderId, checkoutId } = await createTestOrder();

    const result = await reconcileReleasedCheckout(orderId);

    expect(result).toMatchObject({
      orderId,
      status: 'failed',
      changed: true
    });

    const order = await db('orders')
      .where({ id: orderId })
      .first();

    const checkout = await db('checkout_requests')
      .where({ id: checkoutId })
      .first();

    const vendorOrders = await db('vendor_orders')
      .where({ order_id: orderId });

    expect(order.status).toBe('cancelled');
    expect(checkout.status).toBe('failed');
    expect(vendorOrders.every((row) => row.status === 'cancelled'))
      .toBe(true);
  });

  test('repeated recovery does not change checkout again', async () => {
    const { orderId } = await createTestOrder();

    await reconcileReleasedCheckout(orderId);

    const second = await reconcileReleasedCheckout(orderId);

    expect(second.changed).toBe(false);
    expect(second.status).toBe('failed');
  });

  test('does not cancel checkout with pending stock', async () => {
    const { orderId } = await createTestOrder('pending');

    const result = await reconcileReleasedCheckout(orderId);

    expect(result).toMatchObject({
      status: 'recovery_required',
      changed: false
    });

    const order = await db('orders')
      .where({ id: orderId })
      .first();

    expect(order.status).toBe('pending');
  });

  test('does not cancel completed checkout', async () => {
    const { orderId, checkoutId } = await createTestOrder();

    await db('checkout_requests')
      .where({ id: checkoutId })
      .update({ status: 'completed' });

    const result = await reconcileReleasedCheckout(orderId);

    expect(result).toMatchObject({
      status: 'completed',
      changed: false
    });

    const order = await db('orders')
      .where({ id: orderId })
      .first();

    expect(order.status).toBe('pending');
  });
});
