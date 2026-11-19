const crypto = require('node:crypto');

const { db } = require('../../config/postgres');

const createPendingReservations = async ({
  orderItems,
  transaction
}) => {
  if (!transaction) {
    throw new Error('A PostgreSQL transaction is required');
  }

  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    throw new Error('Order items are required');
  }

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const reservations = orderItems.map((item) => ({
    id: crypto.randomUUID(),
    order_item_id: item.orderItemId,
    product_id: item.productId,
    quantity: item.quantity,
    status: 'pending',
    expires_at: expiresAt
  }));

  await transaction('stock_reservations').insert(reservations);

  return reservations.map((reservation) => ({
    reservationId: reservation.id,
    orderItemId: reservation.order_item_id,
    productId: reservation.product_id,
    quantity: reservation.quantity,
    status: reservation.status,
    expiresAt: reservation.expires_at
  }));
};

const markReservationReserved = async (reservationId) => {
  const updated = await db('stock_reservations')
    .where({
      id: reservationId,
      status: 'pending'
    })
    .update({
      status: 'reserved',
      reserved_at: db.fn.now(),
      updated_at: db.fn.now()
    });

  if (updated !== 1) {
    throw new Error('Unable to mark stock reservation as reserved');
  }
};

const markReservationReleased = async (reservationId) => {
  const updated = await db('stock_reservations')
    .where({
      id: reservationId,
      status: 'reserved'
    })
    .update({
      status: 'released',
      released_at: db.fn.now(),
      updated_at: db.fn.now()
    });

  if (updated !== 1) {
    throw new Error('Unable to mark stock reservation as released');
  }
};

const getOrderReservations = async (orderId) => {
  if (!orderId) {
    throw new Error('Order ID is required');
  }

  const rows = await db('stock_reservations as sr')
    .join('order_items as oi', 'sr.order_item_id', 'oi.id')
    .join('vendor_orders as vo', 'oi.vendor_order_id', 'vo.id')
    .where('vo.order_id', orderId)
    .select(
      'sr.id',
      'sr.order_item_id',
      'sr.product_id',
      'sr.quantity',
      'sr.status',
      'sr.expires_at'
    )
    .orderBy('sr.created_at', 'asc');

  return rows.map((row) => ({
    reservationId: row.id,
    orderItemId: row.order_item_id,
    productId: row.product_id,
    quantity: row.quantity,
    status: row.status,
    expiresAt: row.expires_at
  }));
};

module.exports = {
  createPendingReservations,
  markReservationReserved,
  markReservationReleased,
  getOrderReservations
};
