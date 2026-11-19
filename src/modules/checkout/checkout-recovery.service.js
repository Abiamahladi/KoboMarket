const { db } = require('../../config/postgres');

const {
  getOrderReservations
} = require('./checkout-stock.repository');

const {
  withOrderLock
} = require('./checkout-order-lock');

/**
 * Reconcile a checkout whose stock reservations
 * have already been safely released.
 *
 * This function does not release stock or reverse payments.
 */
const reconcileReleasedCheckout = async (orderId) => {
  if (!orderId) {
    throw new Error('Order ID is required');
  }

  return withOrderLock(orderId, async () => {
    const checkout = await db('checkout_requests')
      .where({ order_id: orderId })
      .first();

    if (!checkout) {
      throw new Error('Checkout request not found');
    }

    if (checkout.status === 'completed') {
      return {
        orderId,
        status: 'completed',
        changed: false
      };
    }

    const reservations = await getOrderReservations(orderId);

    if (
      reservations.length === 0 ||
      !reservations.every(
        (reservation) => reservation.status === 'released'
      )
    ) {
      return {
        orderId,
        status: 'recovery_required',
        changed: false
      };
    }

    return db.transaction(async (trx) => {
      const order = await trx('orders')
        .where({ id: orderId })
        .forUpdate()
        .first();

      if (!order) {
        throw new Error('Order not found');
      }

      // Recheck the checkout status inside the transaction.
      const currentCheckout = await trx('checkout_requests')
        .where({ id: checkout.id })
        .forUpdate()
        .first();

      if (
        !currentCheckout ||
        currentCheckout.status !== 'processing'
      ) {
        return {
          orderId,
          status: currentCheckout?.status || 'recovery_required',
          changed: false
        };
      }

      // Never automatically cancel an order with payment history.
      // Payment reconciliation must determine whether funds moved.
      const existingPayment = await trx('payments')
        .where({
          order_id: orderId,
          payment_type: 'order'
        })
        .first();

      if (existingPayment) {
        return {
          orderId,
          status: 'payment_reconciliation_required',
          changed: false
        };
      }

      // Do not cancel orders that may have progressed
      // into payment or fulfillment.
      if (order.status !== 'pending') {
        return {
          orderId,
          status: 'manual_review_required',
          changed: false
        };
      }

      await trx('orders')
        .where({ id: orderId })
        .update({
          status: 'cancelled',
          updated_at: trx.fn.now()
        });

      await trx('vendor_orders')
        .where({ order_id: orderId })
        .update({
          status: 'cancelled',
          updated_at: trx.fn.now()
        });

      await trx('checkout_requests')
        .where({ id: checkout.id })
        .where({ status: 'processing' })
        .update({
          status: 'failed',
          last_error: 'Stock reservation released',
          updated_at: trx.fn.now()
        });

      return {
        orderId,
        status: 'failed',
        changed: true
      };
    });
  });
};

module.exports = {
  reconcileReleasedCheckout
};
