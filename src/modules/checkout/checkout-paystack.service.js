const crypto = require('node:crypto');

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

const initializePaystackCheckout = async ({
  userId,
  orderId,
  email
}) => {
  if (!userId || !orderId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw fail('Valid user ID, order ID and email are required', 400);
  }

  if (!env.PAYSTACK_SECRET_KEY.startsWith('sk_test_')) {
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

    if (order.status !== 'pending' || order.currency !== 'NGN') {
      throw fail('Order is not eligible for Paystack checkout');
    }

    // Do not return an existing authorization URL until
    // checkout and stock reservations have been validated.

    const checkout = await db('checkout_requests')
      .where({ order_id: orderId, user_id: userId })
      .first();

    if (!checkout || checkout.status !== 'processing') {
      throw fail('Checkout is not ready for payment');
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
      throw fail('Order stock reservations are incomplete');
    }

    for (const reservation of reservations) {
      if (
        reservation.status !== 'reserved' ||
        new Date(reservation.expiresAt) <= new Date()
      ) {
        throw fail('Order stock reservation has expired or is unavailable');
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
        throw fail('Stock reservation requires reconciliation');
      }
    }

    const vendorOrders = await db('vendor_orders')
      .where({ order_id: orderId });

    const amount = BigInt(order.total_amount);

    if (
      amount <= 0n ||
      amount > BigInt(Number.MAX_SAFE_INTEGER) ||
      vendorOrders.length === 0 ||
      vendorOrders.some(
        item => item.status !== 'pending' || item.currency !== 'NGN'
      ) ||
      vendorOrders.reduce(
        (total, item) => total + BigInt(item.total_amount),
        0n
      ) !== amount
    ) {
      throw fail('Order totals are invalid');
    }

    const previous = await db('payments')
      .where({ order_id: orderId, payment_type: 'order' })
      .orderBy('created_at', 'desc')
      .first();

    if (previous) {
      if (
        previous.provider === 'paystack' &&
        previous.status === 'pending' &&
        previous.authorization_url &&
        previous.currency === 'NGN' &&
        BigInt(previous.amount) === amount
      ) {
        return {
          orderId,
          paymentId: previous.id,
          reference: previous.provider_reference,
          authorizationUrl: previous.authorization_url,
          amountKobo: String(previous.amount),
          currency: previous.currency,
          reused: true
        };
      }

      throw fail(
        'An existing payment requires verification or reconciliation'
      );
    }

    const reference = `KM-ORDER-${crypto.randomUUID()}`;

    const [payment] = await db('payments')
      .insert({
        order_id: orderId,
        wallet_id: null,
        payment_type: 'order',
        provider: 'paystack',
        payment_method: 'paystack',
        provider_reference: reference,
        currency: 'NGN',
        amount: amount.toString(),
        status: 'pending',
        idempotency_key: `paystack-order:${orderId}`
      })
      .returning('*');

    let response;
    let result;

    try {
      response = await fetch(
        `${env.PAYSTACK_BASE_URL}/transaction/initialize`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email,
            amount: Number(amount),
            currency: 'NGN',
            reference,
            metadata: {
              paymentId: payment.id,
              orderId,
              userId,
              paymentType: 'order'
            }
          }),
          signal: AbortSignal.timeout(15000)
        }
      );

      result = await response.json();
    } catch (error) {
      throw fail(
        'Paystack initialization is uncertain. Verify this payment before retrying.',
        502
      );
    }

    if (
      !response.ok ||
      !result.status ||
      !result.data?.authorization_url ||
      result.data.reference !== reference
    ) {
      // Preserve the pending payment until its provider status is resolved.
      throw fail(
        'Paystack initialization was not confirmed. Payment requires verification.',
        502
      );
    }

    await db('payments')
      .where({ id: payment.id, status: 'pending' })
      .update({
        authorization_url: result.data.authorization_url,
        updated_at: db.fn.now()
      });

    return {
      orderId,
      paymentId: payment.id,
      reference,
      authorizationUrl: result.data.authorization_url,
      amountKobo: amount.toString(),
      currency: 'NGN',
      reused: false
    };
  });
};

module.exports = {
  initializePaystackCheckout
};
