const { db } = require('../../config/postgres');

const { cartService } = require('../cart/cart.service');

const {
  hashCheckoutRequest,
  claimCheckout
} = require('./checkout-idempotency.repository');

const {
  createOrder
} = require('./checkout.repository');

const {
  createPendingReservations
} = require('./checkout-stock.repository');

const prepareCheckout = async ({
  userId,
  idempotencyKey,
  shippingAddress,
  paymentMethod,
  transaction = null,
  cartOverride = null
}) => {
  if (!userId || !idempotencyKey || !shippingAddress) {
    throw new Error('Missing required checkout information');
  }

  if (!['wallet', 'paystack'].includes(paymentMethod)) {
    throw new Error('Unsupported payment method');
  }

  // Read the latest cart from Redis.
  const cart = cartOverride || await cartService.getCart(userId);

  if (!cart.items.length) {
    throw new Error('Cannot checkout an empty cart');
  }

  if (
    cart.hasUnavailableItems ||
    cart.items.some((item) => !item.available)
  ) {
    throw new Error('Cart contains unavailable products');
  }

  const requestHash = hashCheckoutRequest({
    userId,
    cart,
    shippingAddress,
    paymentMethod
  });

  const execute = async (trx) => {
    // Claim the checkout key first.
    const { claimed, checkout } = await claimCheckout({
      userId,
      idempotencyKey,
      requestHash,
      transaction: trx
    });

    if (!claimed) {
      return {
        claimed: false,
        checkoutId: checkout.id,
        orderId: checkout.order_id,
        status: checkout.status
      };
    }

    // Create the customer order and vendor orders.
    const order = await createOrder({
      userId,
      cart,
      shippingAddress,
      paymentMethod,
      transaction: trx
    });

    // Create matching PostgreSQL reservation records.
    const reservations = await createPendingReservations({
      orderItems: order.orderItems,
      transaction: trx
    });

    // Associate the checkout request with the order.
    await trx('checkout_requests')
      .where({ id: checkout.id })
      .update({
        order_id: order.orderId,
        updated_at: trx.fn.now()
      });

    return {
      claimed: true,
      checkoutId: checkout.id,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      status: 'processing',
      totalAmountKobo: order.totalAmountKobo,
      currency: order.currency,
      reservations
    };
  };

  return transaction
    ? execute(transaction)
    : db.transaction(execute);
};

module.exports = {
  prepareCheckout
};
