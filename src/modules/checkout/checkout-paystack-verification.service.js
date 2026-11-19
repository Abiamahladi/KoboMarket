const { db } = require('../../config/postgres');
const env = require('../../config/env');
const StockReservation = require('./stock-reservation.model');
const { withOrderLock } = require('./checkout-order-lock');
const { getOrderReservations } = require('./checkout-stock.repository');

const fail = (message, statusCode = 409) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const verifyPaystackOrder = async ({ userId, orderId, reference }) => {
  if (!userId || !orderId || !reference) {
    throw fail('User ID, order ID and payment reference are required', 400);
  }

  if (!env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
    throw fail('Paystack test secret key is required', 500);
  }

  return withOrderLock(orderId, async () => {
    const order = await db('orders')
      .where({ id: orderId, user_id: userId })
      .first();

    if (!order) {
      throw fail('Order not found', 404);
    }

    if (order.payment_method !== 'paystack') {
      throw fail('Order was not prepared for Paystack payment');
    }

    const payment = await db('payments')
      .where({
        order_id: orderId,
        payment_type: 'order',
        provider: 'paystack',
        provider_reference: reference
      })
      .first();

    if (!payment) {
      throw fail('Paystack order payment not found', 404);
    }

    if (payment.status === 'successful') {
      return {
        orderId,
        paymentId: payment.id,
        reference,
        providerStatus: 'success',
        settlementStatus: 'already_settled',
        duplicate: true
      };
    }

    if (payment.status !== 'pending') {
      throw fail('Payment requires reconciliation');
    }

    let response;
    let result;

    try {
      response = await fetch(
        `${env.PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`
          },
          signal: AbortSignal.timeout(15000)
        }
      );

      result = await response.json();
    } catch (error) {
      throw fail('Unable to verify payment with Paystack', 502);
    }

    if (!response.ok || !result?.status || !result.data) {
      throw fail('Paystack verification was not confirmed', 502);
    }

    const verified = result.data;

    if (
      verified.reference !== reference ||
      String(verified.amount) !== String(payment.amount) ||
      verified.currency !== payment.currency
    ) {
      throw fail('Paystack transaction details do not match our payment');
    }

    if (verified.status !== 'success') {
      return {
        orderId,
        paymentId: payment.id,
        reference,
        providerStatus: verified.status,
        settlementStatus: 'not_settled',
        duplicate: false
      };
    }

    const checkout = await db('checkout_requests')
      .where({ order_id: orderId, user_id: userId })
      .first();

    if (
      order.status !== 'pending' ||
      checkout?.status !== 'processing'
    ) {
      return {
        orderId,
        paymentId: payment.id,
        reference,
        providerStatus: 'success',
        settlementStatus: 'reconciliation_required',
        reason: 'Order or checkout status is not eligible for settlement'
      };
    }

    const reservations = await getOrderReservations(orderId);

    const itemCount = await db('order_items as oi')
      .join('vendor_orders as vo', 'oi.vendor_order_id', 'vo.id')
      .where('vo.order_id', orderId)
      .count('* as total')
      .first();

    if (
      reservations.length === 0 ||
      reservations.length !== Number(itemCount.total)
    ) {
      return {
        orderId,
        paymentId: payment.id,
        reference,
        providerStatus: 'success',
        settlementStatus: 'reconciliation_required',
        reason: 'Order stock reservations are incomplete'
      };
    }

    for (const reservation of reservations) {
      if (
        reservation.status !== 'reserved' ||
        new Date(reservation.expiresAt) <= new Date()
      ) {
        return {
          orderId,
          paymentId: payment.id,
          reference,
          providerStatus: 'success',
          settlementStatus: 'reconciliation_required',
          reason: 'Order stock reservation has expired'
        };
      }

      const mongoReservation = await StockReservation.findOne({
        reservationId: reservation.reservationId
      });

      if (
        !mongoReservation ||
        mongoReservation.status !== 'reserved' ||
        mongoReservation.orderItemId !== reservation.orderItemId ||
        mongoReservation.productId !== reservation.productId ||
        Number(mongoReservation.quantity) !== Number(reservation.quantity) ||
        new Date(mongoReservation.expiresAt) <= new Date()
      ) {
        return {
          orderId,
          paymentId: payment.id,
          reference,
          providerStatus: 'success',
          settlementStatus: 'reconciliation_required',
          reason: 'MongoDB stock reservation requires reconciliation'
        };
      }
    }

    return {
      orderId,
      paymentId: payment.id,
      reference,
      providerStatus: 'success',
      settlementStatus: 'ready_for_settlement',
      amountKobo: String(payment.amount),
      currency: payment.currency,
      duplicate: false
    };
  });
};

module.exports = {
  verifyPaystackOrder
};
