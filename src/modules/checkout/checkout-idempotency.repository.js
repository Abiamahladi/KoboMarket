const crypto = require('node:crypto');

const { db } = require('../../config/postgres');

const hashCheckoutRequest = ({
  userId,
  cart,
  shippingAddress,
  paymentMethod
}) => {
  const items = cart.items
    .map((item) => ({
      productId: item.productId,
      vendorId: item.vendorId,
      quantity: item.quantity,
      priceKobo: item.priceKobo,
      currency: item.currency
    }))
    .sort((a, b) =>
      a.productId.localeCompare(b.productId)
    );

  const payload = {
    userId,
    items,
    shippingAddress,
    paymentMethod
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
};

const claimCheckout = async ({
  userId,
  idempotencyKey,
  requestHash,
  transaction = null
}) => {
  if (!userId || !idempotencyKey) {
    throw new Error(
      'User ID and idempotency key are required'
    );
  }

  if (!/^[a-f0-9]{64}$/.test(requestHash || '')) {
    throw new Error('Invalid checkout request hash');
  }

  const connection = transaction || db;

  const checkoutId = crypto.randomUUID();

  // PostgreSQL uniqueness prevents two simultaneous
  // requests from claiming the same checkout key.
  const inserted = await connection('checkout_requests')
    .insert({
      id: checkoutId,
      user_id: userId,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      status: 'processing'
    })
    .onConflict(['user_id', 'idempotency_key'])
    .ignore()
    .returning('id');

  const claimed = inserted.length > 0;

  const checkout = await connection('checkout_requests')
    .where({
      user_id: userId,
      idempotency_key: idempotencyKey
    })
    .first();

  if (!checkout) {
    throw new Error('Unable to retrieve checkout request');
  }

  if (checkout.request_hash !== requestHash) {
    const error = new Error(
      'Idempotency key was already used for different checkout details'
    );

    error.statusCode = 409;
    throw error;
  }

  return {
    claimed,
    checkout
  };
};

module.exports = {
  hashCheckoutRequest,
  claimCheckout
};
