const { db } = require('../../config/postgres');
const StockReservation = require('./stock-reservation.model');
const { commitStock } = require('./stock-reservation.service');
const { getOrderReservations } = require('./checkout-stock.repository');
const { withOrderLock } = require('./checkout-order-lock');

const finalizeOrderStock = async (orderId) => {
  if (!orderId) {
    throw new Error('Order ID is required');
  }

  return withOrderLock(orderId, async () => {
    const order = await db('orders')
      .where({ id: orderId })
      .first();

    if (!order) {
      throw new Error('Order not found');
    }

    const checkout = await db('checkout_requests')
      .where({ order_id: orderId })
      .first();

    if (
      !checkout ||
      checkout.status !== 'completed' ||
      !['confirmed', 'processing', 'fulfilled', 'completed'].includes(order.status)
    ) {
      throw new Error('Order has not completed payment');
    }

    const payment = await db('payments')
      .where({
        order_id: orderId,
        payment_type: 'order',
        status: 'successful'
      })
      .first();

    if (!payment) {
      throw new Error('Successful order payment not found');
    }

    const reservations = await getOrderReservations(orderId);

    if (!reservations.length) {
      throw new Error('No stock reservations found');
    }

    const results = [];

    for (const reservation of reservations) {
      if (reservation.status === 'committed') {
        const existing = await StockReservation.findOne({
          reservationId: reservation.reservationId
        });

        if (!existing || existing.status !== 'committed') {
          throw new Error('Committed stock state requires reconciliation');
        }

        results.push({
          reservationId: reservation.reservationId,
          status: 'committed'
        });

        continue;
      }

      if (reservation.status !== 'reserved') {
        throw new Error('Stock reservation cannot be committed');
      }

      const existing = await StockReservation.findOne({
        reservationId: reservation.reservationId
      });

      if (
        !existing ||
        existing.orderItemId !== reservation.orderItemId ||
        existing.productId !== reservation.productId ||
        Number(existing.quantity) !== Number(reservation.quantity) ||
        !['reserved', 'committed'].includes(existing.status)
      ) {
        throw new Error('Stock reservation requires reconciliation');
      }

      if (existing.status === 'reserved') {
        await commitStock(reservation.reservationId);
      }

      // Update PostgreSQL only after MongoDB confirms commitment.
      const updated = await db('stock_reservations')
        .where({
          id: reservation.reservationId,
          status: 'reserved'
        })
        .update({
          status: 'committed',
          committed_at: db.fn.now(),
          updated_at: db.fn.now()
        });

      if (updated !== 1) {
        throw new Error('Unable to record stock commitment');
      }

      results.push({
        reservationId: reservation.reservationId,
        status: 'committed'
      });
    }

    return {
      orderId,
      status: 'stock_committed',
      reservations: results
    };
  });
};

module.exports = { finalizeOrderStock };
