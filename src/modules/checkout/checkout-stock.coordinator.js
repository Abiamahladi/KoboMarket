const { db } = require('../../config/postgres');

const StockReservation = require('./stock-reservation.model');

const {
  reserveStock
} = require('./stock-reservation.service');

const {
  getOrderReservations,
  markReservationReserved
} = require('./checkout-stock.repository');

const createError = (message) => {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
};

const {
  releaseOrderStockUnlocked
} = require('./checkout-stock.recovery');

const reserveOrderStockUnlocked = async (orderId) => {
  if (!orderId) {
    throw new Error('Order ID is required');
  }

  const reservations = await getOrderReservations(orderId);

  if (reservations.length === 0) {
    throw new Error('No stock reservations found for order');
  }

  const results = [];

  try {
    for (const reservation of reservations) {
      if (!['pending', 'reserved'].includes(reservation.status)) {
        throw createError(
          'Order contains a reservation that cannot be processed'
        );
      }

      const expiresAt = new Date(reservation.expiresAt);

      if (expiresAt <= new Date()) {
        throw createError('Stock reservation has expired');
      }

      const existing = await StockReservation.findOne({
        reservationId: reservation.reservationId
      });

      if (existing) {
        if (
          existing.orderItemId !== reservation.orderItemId ||
          existing.productId !== reservation.productId ||
          existing.quantity !== reservation.quantity
        ) {
          throw createError('Stock reservation data mismatch');
        }

        if (
          existing.status !== 'reserved' ||
          existing.expiresAt <= new Date()
        ) {
          throw createError('Stock reservation is no longer active');
        }
      } else {
        if (reservation.status === 'reserved') {
          throw new Error(
            'Reservation state mismatch requires reconciliation'
          );
        }

        await reserveStock({
          reservationId: reservation.reservationId,
          orderItemId: reservation.orderItemId,
          productId: reservation.productId,
          quantity: reservation.quantity,
          expiresAt
        });
      }

      if (reservation.status === 'pending') {
        await markReservationReserved(reservation.reservationId);
      }

      results.push({
        reservationId: reservation.reservationId,
        orderItemId: reservation.orderItemId,
        status: 'reserved'
      });
    }

    return {
      orderId,
      status: 'stock_reserved',
      reservations: results
    };
  } catch (error) {
    // Only compensate failures explicitly classified as definite.
    // Other errors may represent uncertain database outcomes.
    if (error.code !== 'INSUFFICIENT_STOCK') {
      error.recoveryRequired = true;
      throw error;
    }

    const recovery = await releaseOrderStockUnlocked(orderId);

    if (recovery.status !== 'released') {
      const recoveryError = new Error(
        'Stock compensation incomplete; reconciliation required'
      );

      recoveryError.recoveryRequired = true;
      recoveryError.failures = recovery.failures;

      throw recoveryError;
    }

    const checkoutError = new Error(error.message);
    checkoutError.statusCode = 409;
    checkoutError.stockReleased = true;

    throw checkoutError;
  }
};

const { withOrderLock } = require('./checkout-order-lock');

const reserveOrderStock = (orderId) =>
  withOrderLock(orderId, () => reserveOrderStockUnlocked(orderId));

module.exports = {
  reserveOrderStock
};
