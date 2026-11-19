const crypto = require('node:crypto');

const { db } = require('../../config/postgres');
const ledgerService = require('../wallets/ledger.service');
const StockReservation = require('./stock-reservation.model');
const { withOrderLock } = require('./checkout-order-lock');
const { getOrderReservations } = require('./checkout-stock.repository');

const fail = (message, statusCode = 409) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const payWithWallet = async ({ userId, orderId, walletId }) => {
  if (!userId || !orderId || !walletId) {
    throw fail('User ID, order ID and wallet ID are required', 400);
  }

  // All checkout operations for this order share the same lock.
  return withOrderLock(orderId, async () => {
    // Check whether this order was already paid.
    const previous = await db('payments')
      .where({
        order_id: orderId,
        payment_type: 'order'
      })
      .orderBy('created_at', 'desc')
      .first();

    if (previous) {
      if (
        previous.status === 'successful' &&
        previous.payment_method === 'wallet'
      ) {
        const order = await db('orders')
          .where({ id: orderId, user_id: userId })
          .first();

        if (!order) {
          throw fail('Order not found', 404);
        }

        const wallet = await db('wallets')
          .where({
            id: walletId,
            user_id: userId,
            wallet_type: 'customer'
          })
          .first();

        if (!wallet) {
          throw fail('Wallet does not belong to this customer', 403);
        }

        // Confirm the original payment was made using this wallet
        // through its linked ledger entry.
        const linkedEntry = await db('ledger_transactions as lt')
          .join('ledger_entries as le', 'lt.id', 'le.transaction_id')
          .where({
            'lt.reference_type': 'payment',
            'lt.reference_id': previous.id,
            'le.wallet_id': walletId,
            'le.entry_type': 'debit',
            'lt.status': 'posted'
          })
          .first();

        if (!linkedEntry) {
          throw fail('Order was paid using another wallet', 409);
        }

        return {
          orderId,
          paymentId: previous.id,
          status: 'successful',
          duplicate: true
        };
      }

      throw fail(
        'This order already has a payment attempt requiring reconciliation'
      );
    }

    const order = await db('orders')
      .where({ id: orderId, user_id: userId })
      .first();

    if (!order) {
      throw fail('Order not found', 404);
    }

    if (order.payment_method !== 'wallet') {
      throw fail('Order was not prepared for wallet payment');
    }

    if (order.payment_method !== 'wallet') {
      throw fail('Order was not prepared for wallet payment');
    }

    if (order.status !== 'pending' || order.currency !== 'NGN') {
      throw fail('Order is not eligible for wallet payment');
    }

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

    // Verify both databases before moving customer funds.
    for (const reservation of reservations) {
      if (
        reservation.status !== 'reserved' ||
        new Date(reservation.expiresAt) <= new Date()
      ) {
        throw fail('Order stock is not fully reserved or has expired');
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

    return db.transaction(async (trx) => {
      const lockedOrder = await trx('orders')
        .where({ id: orderId, user_id: userId })
        .forUpdate()
        .first();

      const lockedCheckout = await trx('checkout_requests')
        .where({ id: checkout.id, order_id: orderId })
        .forUpdate()
        .first();

      if (
        !lockedOrder ||
        lockedOrder.status !== 'pending' ||
        !lockedCheckout ||
        lockedCheckout.status !== 'processing'
      ) {
        throw fail('Checkout status changed before payment');
      }

      const wallet = await trx('wallets')
        .where({
          id: walletId,
          user_id: userId,
          wallet_type: 'customer',
          currency: 'NGN',
          status: 'active'
        })
        .first();

      if (!wallet) {
        throw fail('Active customer wallet not found', 404);
      }

      const vendorOrders = await trx('vendor_orders')
        .where({ order_id: orderId })
        .orderBy('id', 'asc');

      if (
        vendorOrders.length === 0 ||
        vendorOrders.some(
          (item) => item.status !== 'pending' || item.currency !== 'NGN'
        )
      ) {
        throw fail('Vendor orders are not ready for payment');
      }

      const total = BigInt(lockedOrder.total_amount);

      if (total <= 0n) {
        throw fail('Order amount must be positive');
      }

      const vendorTotal = vendorOrders.reduce(
        (sum, item) => sum + BigInt(item.total_amount),
        0n
      );

      if (vendorOrders.some(
        (item) => BigInt(item.total_amount) <= 0n
      )) {
        throw fail('Every vendor escrow amount must be positive');
      }

      if (vendorTotal !== total) {
        throw fail('Vendor order totals do not match checkout total');
      }

      const accounts = await trx('financial_accounts')
        .where({ currency: 'NGN', is_active: true })
        .whereIn('account_code', [
          'CUSTOMER_WALLET_LIABILITY',
          'ESCROW_LIABILITY'
        ]);

      const customerAccount = accounts.find(
        (item) => item.account_code === 'CUSTOMER_WALLET_LIABILITY'
      );

      const escrowAccount = accounts.find(
        (item) => item.account_code === 'ESCROW_LIABILITY'
      );

      if (!customerAccount || !escrowAccount) {
        throw fail('Required financial accounts are missing', 500);
      }

      const [payment] = await trx('payments')
        .insert({
          order_id: orderId,
          wallet_id: null,
          payment_type: 'order',
          provider: 'wallet',
          payment_method: 'wallet',
          provider_reference: `KM-WALLET-${crypto.randomUUID()}`,
          currency: 'NGN',
          amount: total.toString(),
          status: 'pending',
          idempotency_key: `wallet-checkout:${orderId}`
        })
        .returning('*');

      const ledger = await ledgerService.postTransaction({
        transactionType: 'wallet_checkout',
        description: `Wallet payment for order ${lockedOrder.order_number}`,
        currency: 'NGN',
        idempotencyKey: `wallet-checkout-ledger:${orderId}`,
        referenceType: 'payment',
        referenceId: payment.id,
        initiatedBy: userId,
        transaction: trx,
        entries: [
          {
            accountId: customerAccount.id,
            walletId,
            entryType: 'debit',
            amount: total.toString()
          },
          {
            accountId: escrowAccount.id,
            entryType: 'credit',
            amount: total.toString()
          }
        ]
      });

      if (ledger.status !== 'posted' || ledger.duplicate) {
        throw fail('Wallet ledger posting requires reconciliation');
      }

      for (const vendorOrder of vendorOrders) {
        await trx('escrows').insert({
          vendor_order_id: vendorOrder.id,
          payment_id: payment.id,
          currency: 'NGN',
          amount: String(vendorOrder.total_amount),
          released_amount: 0,
          refunded_amount: 0,
          status: 'held'
        });
      }

      await trx('payments')
        .where({ id: payment.id, status: 'pending' })
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
        .where({ id: checkout.id })
        .update({
          status: 'completed',
          updated_at: trx.fn.now()
        });

      return {
        orderId,
        paymentId: payment.id,
        ledgerTransactionId: ledger.transactionId,
        amountKobo: total.toString(),
        currency: 'NGN',
        status: 'successful',
        escrowCount: vendorOrders.length,
        duplicate: false
      };
    });
  });
};

module.exports = { payWithWallet };
