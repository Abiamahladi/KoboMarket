
const { db } = require('../../config/postgres');

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const ledgerService = {
  async postTransaction({
    transactionType,
    description,
    currency = 'NGN',
    idempotencyKey,
    referenceType = null,
    referenceId = null,
    initiatedBy = null,
    entries,
    transaction = null
  }) {
    if (!transactionType || !Array.isArray(entries) || entries.length < 2) {
      throw createError('A transaction requires a type and at least two entries');
    }

    if (!idempotencyKey || idempotencyKey.length > 150) {
      throw createError('A valid idempotency key is required');
    }

    let totalDebits = 0n;
    let totalCredits = 0n;

    for (const entry of entries) {
      if (!['debit', 'credit'].includes(entry.entryType)) {
        throw createError('Invalid ledger entry type');
      }

      if (!/^[1-9]\d*$/.test(String(entry.amount))) {
        throw createError('Ledger amounts must be positive whole-number strings');
      }

      const amount = BigInt(entry.amount);

      if (entry.entryType === 'debit') totalDebits += amount;
      if (entry.entryType === 'credit') totalCredits += amount;
    }

    if (totalDebits !== totalCredits) {
      throw createError('Ledger transaction is not balanced');
    }

    const execute = async (trx) => {
      const existing = await trx('ledger_transactions')
        .where({ idempotency_key: idempotencyKey })
        .first();

      if (existing) {
        if (existing.status !== 'posted') {
          throw createError('An operation with this idempotency key is already being processed', 409);
        }

        return {
          transactionId: existing.id,
          status: existing.status,
          duplicate: true
        };
      }

      const [transaction] = await trx('ledger_transactions')
        .insert({
          transaction_type: transactionType,
          description,
          currency,
          status: 'draft',
          idempotency_key: idempotencyKey,
          reference_type: referenceType,
          reference_id: referenceId,
          initiated_by: initiatedBy
        })
        .returning('*');

      // Lock every affected wallet balance in a stable order.
      const walletIds = [...new Set(
        entries.map((entry) => entry.walletId).filter(Boolean)
      )].sort();

      if (walletIds.length > 0) {
        const balances = await trx('wallet_balances')
          .whereIn('wallet_id', walletIds)
          .orderBy('wallet_id', 'asc')
          .forUpdate();

        if (balances.length !== walletIds.length) {
          throw createError('One or more wallet balance records do not exist', 404);
        }
      }

      for (const entry of entries) {
        const account = await trx('financial_accounts')
          .where({
            id: entry.accountId,
            currency,
            is_active: true
          })
          .first();

        if (!account) {
          throw createError('Financial account not found or inactive', 404);
        }

        if (entry.walletId) {
          const wallet = await trx('wallets')
            .where({
              id: entry.walletId,
              currency,
              status: 'active'
            })
            .first();

          if (!wallet) {
            throw createError('Wallet not found, inactive, or currency mismatch', 400);
          }

          if (
            (wallet.wallet_type === 'customer' &&
              account.account_code !== 'CUSTOMER_WALLET_LIABILITY') ||
            (wallet.wallet_type === 'vendor' &&
              account.account_code !== 'VENDOR_WALLET_LIABILITY')
          ) {
            throw createError('Wallet entry uses an incompatible financial account');
          }
        }

        await trx('ledger_entries').insert({
          transaction_id: transaction.id,
          account_id: entry.accountId,
          wallet_id: entry.walletId || null,
          entry_type: entry.entryType,
          amount: String(entry.amount)
        });

        // Wallet liabilities increase with credits and decrease with debits.
        if (entry.walletId) {
          const column = entry.entryType === 'credit'
            ? 'available_balance'
            : 'available_balance';

          const current = await trx('wallet_balances')
            .where({ wallet_id: entry.walletId })
            .first();

          const currentBalance = BigInt(current[column]);
          const amount = BigInt(entry.amount);

          if (entry.entryType === 'debit' && currentBalance < amount) {
            throw createError('Insufficient wallet balance');
          }

          const nextBalance = entry.entryType === 'credit'
            ? currentBalance + amount
            : currentBalance - amount;

          await trx('wallet_balances')
            .where({ wallet_id: entry.walletId })
            .update({
              [column]: nextBalance.toString(),
              updated_at: trx.fn.now()
            });
        }
      }

      await trx('ledger_transactions')
        .where({ id: transaction.id })
        .update({
          status: 'posted',
          posted_at: trx.fn.now()
        });

      return {
        transactionId: transaction.id,
        status: 'posted',
        duplicate: false
      };
    };

    return transaction
      ? execute(transaction)
      : db.transaction(execute);
  }
};

module.exports = ledgerService;
