const {
  payWithWallet
} = require('./checkout-wallet-payment.service');

const {
  finalizeOrderStock
} = require('./checkout-stock-finalization.service');

const {
  settlePaystackOrder
} = require('./checkout-paystack-settlement.service');

const completeWalletCheckout = async ({
  userId,
  orderId,
  walletId
}) => {
  // The wallet service holds and releases the order lock.
  // It also makes payment idempotent.
  const payment = await payWithWallet({
    userId,
    orderId,
    walletId
  });

  // This acquires a new order lock after payment returns.
  // A failure here must not trigger another wallet debit.
  try {
    const stock = await finalizeOrderStock(orderId);

    return {
      ...payment,
      stockStatus: stock.status,
      stockReservations: stock.reservations.length
    };
  } catch (error) {
    // Payment has already succeeded in PostgreSQL.
    // Preserve that result and report the recovery requirement.
    return {
      ...payment,
      stockStatus: 'reconciliation_required',
      stockError: error.message
    };
  }
};

const completePaystackCheckout = async ({
  userId,
  orderId,
  reference
}) => {
  if (!userId || !orderId || !reference) {
    const error = new Error(
      'User ID, order ID and payment reference are required'
    );
    error.statusCode = 400;
    throw error;
  }

  // Paystack verification and financial settlement happen first.
  // The settlement service manages its own order lock.
  const payment = await settlePaystackOrder({
    userId,
    orderId,
    reference
  });

  // A pending, failed, or reconciliation-required payment
  // must never trigger stock commitment.
  if (payment.status !== 'successful') {
    return {
      ...payment,
      stockStatus: 'not_committed'
    };
  }

  // Payment is already successful in PostgreSQL.
  // Finalization acquires a new order lock.
  try {
    const stock = await finalizeOrderStock(orderId);

    return {
      ...payment,
      stockStatus: stock.status,
      stockReservations: stock.reservations.length
    };
  } catch (error) {
    // Do not retry payment settlement or reverse the ledger.
    // The existing financial records remain authoritative.
    return {
      ...payment,
      stockStatus: 'reconciliation_required',
      stockError: error.message
    };
  }
};

module.exports = {
  completeWalletCheckout,
  completePaystackCheckout
};
