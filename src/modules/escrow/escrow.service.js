const { db } = require('../../config/postgres');
const Vendor = require('../vendors/vendor.model');
const ledgerService = require('../wallets/ledger.service');

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const releaseEscrow = async ({ vendorOrderId, initiatedBy }) => {
  if (!vendorOrderId || !initiatedBy) {
    throw fail('Vendor order ID and initiating user are required');
  }

  // Resolve the vendor before beginning the PostgreSQL transaction.
  const vendorOrder = await db('vendor_orders')
    .where({ id: vendorOrderId })
    .first();

  if (!vendorOrder) {
    throw fail('Vendor order not found', 404);
  }

  const vendor = await Vendor.findOne({
    vendorId: vendorOrder.vendor_id,
    status: 'approved'
  }).lean();

  if (!vendor) {
    throw fail('Approved vendor not found', 404);
  }

  return db.transaction(async (trx) => {
    // Lock the escrow record to serialize concurrent releases.
    const escrow = await trx('escrows')
      .where({ vendor_order_id: vendorOrderId })
      .forUpdate()
      .first();

    if (!escrow) {
      throw fail('Escrow record not found', 404);
    }

    if (escrow.status === 'released') {
      return {
        escrowId: escrow.id,
        vendorOrderId,
        status: 'released',
        duplicate: true
      };
    }

    if (escrow.status !== 'held') {
      throw fail('Escrow is not eligible for full release', 409);
    }

    const lockedOrder = await trx('vendor_orders')
      .where({ id: vendorOrderId })
      .first();

    if (lockedOrder.status !== 'delivered') {
      throw fail('Vendor order must be delivered before escrow release', 409);
    }

    const payment = await trx('payments')
      .where({ id: escrow.payment_id })
      .first();

    if (
      !payment ||
      payment.status !== 'successful' ||
      payment.order_id !== lockedOrder.order_id ||
      payment.currency.trim() !== escrow.currency.trim()
    ) {
      throw fail('Payment has not been confirmed for this order', 409);
    }

    const dispute = await trx('disputes')
      .where({ vendor_order_id: vendorOrderId })
      .whereIn('status', ['open', 'under_review'])
      .first();

    if (dispute) {
      throw fail('Escrow cannot be released while a dispute is active', 409);
    }

    const amount = BigInt(escrow.amount);
    const released = BigInt(escrow.released_amount);
    const refunded = BigInt(escrow.refunded_amount);

    const remaining = amount - released - refunded;

    if (remaining <= 0n) {
      throw fail('No escrow balance available for release', 409);
    }

    const wallet = await trx('wallets')
      .where({
        user_id: vendor.userId,
        wallet_type: 'vendor',
        currency: escrow.currency,
        status: 'active'
      })
      .first();

    if (!wallet) {
      throw fail('Active vendor wallet not found', 404);
    }

    const accounts = await trx('financial_accounts')
      .where({
        currency: escrow.currency,
        is_active: true
      })
      .whereIn('account_code', [
        'ESCROW_LIABILITY',
        'VENDOR_WALLET_LIABILITY'
      ]);

    const escrowAccount = accounts.find(
      account => account.account_code === 'ESCROW_LIABILITY'
    );

    const vendorAccount = accounts.find(
      account => account.account_code === 'VENDOR_WALLET_LIABILITY'
    );

    if (!escrowAccount || !vendorAccount) {
      throw fail('Required financial accounts are missing', 500);
    }

    const ledger = await ledgerService.postTransaction({
      transactionType: 'escrow_release',
      description: `Escrow release for vendor order ${vendorOrderId}`,
      currency: escrow.currency,
      idempotencyKey: `escrow-release:${escrow.id}`,
      referenceType: 'escrow',
      referenceId: escrow.id,
      initiatedBy,
      transaction: trx,
      entries: [
        {
          accountId: escrowAccount.id,
          entryType: 'debit',
          amount: remaining.toString()
        },
        {
          accountId: vendorAccount.id,
          walletId: wallet.id,
          entryType: 'credit',
          amount: remaining.toString()
        }
      ]
    });

    if (ledger.status !== 'posted' || ledger.duplicate) {
      throw fail('Escrow ledger posting requires reconciliation', 409);
    }

    await trx('escrows')
      .where({ id: escrow.id })
      .update({
        released_amount: (released + remaining).toString(),
        status: 'released',
        released_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });

    return {
      escrowId: escrow.id,
      vendorOrderId,
      vendorId: vendor.vendorId,
      walletId: wallet.id,
      amountReleasedKobo: remaining.toString(),
      currency: escrow.currency.trim(),
      ledgerTransactionId: ledger.transactionId,
      status: 'released',
      duplicate: false
    };
  });
};

module.exports = { releaseEscrow };
