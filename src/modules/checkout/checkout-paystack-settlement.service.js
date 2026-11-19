const { db } = require('../../config/postgres');
const ledgerService = require('../wallets/ledger.service');
const StockReservation = require('./stock-reservation.model');

const { withOrderLock } = require('./checkout-order-lock');
const { getOrderReservations } = require('./checkout-stock.repository');
const {
  verifyPaystackOrder
} = require('./checkout-paystack-verification.service');

const fail = (message, statusCode = 409) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const settlePaystackOrder = async ({ userId, orderId, reference }) => {
  if (!userId || !orderId || !reference) {
    throw fail('User ID, order ID and reference are required', 400);
  }

  // Verify the payment with Paystack before attempting settlement.
  // This service does not move money or create escrow.
  const verification = await verifyPaystackOrder({
    userId,
    orderId,
    reference
  });

  if (verification.settlementStatus === 'already_settled') {
    return {
      orderId,
      paymentId: verification.paymentId,
      reference,
      status: 'successful',
      duplicate: true
    };
  }

  if (verification.settlementStatus !== 'ready_for_settlement') {
    return {
      ...verification,
      settled: false
    };
  }

  // Reacquire the order lock. The earlier verification lock
  // was released when verification returned.
  return withOrderLock(orderId, async () => {
    const order = await db('orders')
      .where({ id: orderId, user_id: userId })
      .first();

    if (!order || order.payment_method !== 'paystack') {
      throw fail('Paystack order not found or payment method mismatch');
    }

    const payment = await db('payments')
      .where({
        id: verification.paymentId,
        order_id: orderId,
        provider: 'paystack',
        payment_type: 'order',
        provider_reference: reference
      })
      .first();

    if (!payment) {
      throw fail('Paystack payment not found', 404);
    }

    if (payment.status === 'successful') {
      return {
        orderId,
        paymentId: payment.id,
        reference,
        status: 'successful',
        duplicate: true
      };
    }

    if (payment.status !== 'pending') {
      throw fail('Payment requires reconciliation');
    }

    const checkout = await db('checkout_requests')
      .where({ order_id: orderId, user_id: userId })
      .first();

    if (
      order.status !== 'pending' ||
      order.currency !== 'NGN' ||
      checkout?.status !== 'processing'
    ) {
      return {
        orderId,
        paymentId: payment.id,
        reference,
        status: 'reconciliation_required',
        reason: 'Order or checkout is no longer eligible'
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
        status: 'reconciliation_required',
        reason: 'Stock reservation count mismatch'
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
          status: 'reconciliation_required',
          reason: 'Stock reservation expired or unavailable'
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
          status: 'reconciliation_required',
          reason: 'MongoDB stock reservation mismatch'
        };
      }
    }

    // All financial changes must succeed or roll back together.
    return db.transaction(async (trx) => {
      const lockedOrder = await trx('orders')
        .where({ id: orderId, user_id: userId })
        .forUpdate()
        .first();

      const lockedPayment = await trx('payments')
        .where({ id: payment.id })
        .forUpdate()
        .first();

      const lockedCheckout = await trx('checkout_requests')
        .where({ id: checkout.id })
        .forUpdate()
        .first();

      if (
        !lockedOrder ||
        lockedOrder.status !== 'pending' ||
        lockedOrder.payment_method !== 'paystack' ||
        !lockedPayment ||
        lockedPayment.status !== 'pending' ||
        !lockedCheckout ||
        lockedCheckout.status !== 'processing'
      ) {
        throw fail('Checkout state changed before settlement');
      }

      const vendorOrders = await trx('vendor_orders')
        .where({ order_id: orderId })
        .orderBy('id', 'asc');

      const amount = BigInt(lockedOrder.total_amount);

      if (
        amount <= 0n ||
        String(lockedPayment.amount) !== amount.toString() ||
        lockedPayment.currency !== 'NGN' ||
        vendorOrders.length === 0 ||
        vendorOrders.some(
          item =>
            item.status !== 'pending' ||
            item.currency !== 'NGN' ||
            BigInt(item.total_amount) <= 0n
        ) ||
        vendorOrders.reduce(
          (total, item) => total + BigInt(item.total_amount),
          0n
        ) !== amount
      ) {
        throw fail('Payment and vendor order totals do not match');
      }

      const accounts = await trx('financial_accounts')
        .where({ currency: 'NGN', is_active: true })
        .whereIn('account_code', [
          'PAYSTACK_CLEARING',
          'ESCROW_LIABILITY'
        ]);

      const clearing = accounts.find(
        account => account.account_code === 'PAYSTACK_CLEARING'
      );

      const escrow = accounts.find(
        account => account.account_code === 'ESCROW_LIABILITY'
      );

      if (!clearing || !escrow) {
        throw fail('Required financial accounts are missing', 500);
      }

      const ledger = await ledgerService.postTransaction({
        transactionType: 'paystack_checkout',
        description: `Paystack payment for order ${lockedOrder.order_number}`,
        currency: 'NGN',
        idempotencyKey: `paystack-order-ledger:${orderId}`,
        referenceType: 'payment',
        referenceId: lockedPayment.id,
        initiatedBy: userId,
        transaction: trx,
        entries: [
          {
            accountId: clearing.id,
            entryType: 'debit',
            amount: amount.toString()
          },
          {
            accountId: escrow.id,
            entryType: 'credit',
            amount: amount.toString()
          }
        ]
      });

      if (ledger.status !== 'posted' || ledger.duplicate) {
        throw fail('Ledger posting requires reconciliation');
      }

      for (const vendorOrder of vendorOrders) {
        await trx('escrows').insert({
          vendor_order_id: vendorOrder.id,
          payment_id: lockedPayment.id,
          currency: 'NGN',
          amount: String(vendorOrder.total_amount),
          released_amount: 0,
          refunded_amount: 0,
          status: 'held'
        });
      }

      await trx('payments')
        .where({ id: lockedPayment.id, status: 'pending' })
        .update({
          status: 'successful',
          paid_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });

      await trx('vendor_orders')
        .where({ order_id: orderId })
        .update({
          status: 'confirmed',
          updated_at: trx.fn.now()
        });

      await trx('orders')
        .where({ id: orderId })
        .update({
          status: 'confirmed',
          updated_at: trx.fn.now()
        });

      await trx('checkout_requests')
        .where({ id: lockedCheckout.id })
        .update({
          status: 'completed',
          updated_at: trx.fn.now()
        });

      return {
        orderId,
        paymentId: lockedPayment.id,
        reference,
        ledgerTransactionId: ledger.transactionId,
        amountKobo: amount.toString(),
        currency: 'NGN',
        status: 'successful',
        escrowCount: vendorOrders.length,
        duplicate: false
      };
    });
  });
};

module.exports = {
  settlePaystackOrder
};
