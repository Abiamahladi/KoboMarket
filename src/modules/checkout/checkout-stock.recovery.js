const { db } = require('../../config/postgres');

const StockReservation = require('./stock-reservation.model');

const {
  releaseStock
} = require('./stock-reservation.service');

const {
  getOrderReservations
} = require('./checkout-stock.repository');

const releaseOrderStockUnlocked = async (orderId) => {
  if (!orderId) {
    throw new Error('Order ID is required');
  }

  const reservations = await getOrderReservations(orderId);

  const results = [];
  const failures = [];

  for (const reservation of reservations) {
    try {
      const existing = await StockReservation.findOne({
        reservationId: reservation.reservationId
      });

      if (existing) {
        if (
          existing.orderItemId !== reservation.orderItemId ||
          existing.productId !== reservation.productId ||
          existing.quantity !== reservation.quantity
        ) {
          throw new Error('Stock reservation data mismatch');
        }

        if (existing.status === 'committed') {
          throw new Error('Committed stock cannot be released');
        }

        if (existing.status === 'reserved') {
          await releaseStock(reservation.reservationId);
        }
      }

      // A missing MongoDB reservation means no stock was deducted
      // by this reservation. A released reservation is already restored.
      const updated = await db('stock_reservations')
        .where({ id: reservation.reservationId })
        .whereIn('status', ['pending', 'reserved', 'failed'])
        .update({
          status: 'released',
          released_at: db.fn.now(),
          updated_at: db.fn.now()
        });

      if (updated !== 1) {
        const row = await db('stock_reservations')
          .where({ id: reservation.reservationId })
          .first();

        if (!row || row.status !== 'released') {
          throw new Error('Unable to record stock release');
        }
      }

      results.push({
        reservationId: reservation.reservationId,
        status: 'released'
      });

    } catch (error) {
      failures.push({
        reservationId: reservation.reservationId,
        error: error.message
      });
    }
  }

  return {
    orderId,
    status: failures.length === 0
      ? 'released'
      : 'recovery_required',
    reservations: results,
    failures
  };
};

const { withOrderLock } = require('./checkout-order-lock');

const releaseOrderStock = (orderId) =>
  withOrderLock(orderId, () => releaseOrderStockUnlocked(orderId));

module.exports = {
  releaseOrderStock,
  releaseOrderStockUnlocked
};
