
const { db } = require('../../config/postgres');

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const walletService = {
  // Create a wallet and its initial balance record.
  async createWallet(userId, walletType, currency = 'NGN') {
    if (!['customer', 'vendor'].includes(walletType)) {
      throw createError('Invalid wallet type');
    }

    return db.transaction(async (trx) => {
      const user = await trx('users')
        .where({ id: userId })
        .first();

      if (!user) {
        throw createError('User account not found', 404);
      }

      const supportedCurrency = await trx('currencies')
        .where({ code: currency, is_enabled: true })
        .first();

      if (!supportedCurrency) {
        throw createError('Currency is not supported');
      }

      const existingWallet = await trx('wallets')
        .where({
          user_id: userId,
          wallet_type: walletType,
          currency
        })
        .first();

      if (existingWallet) {
        return this.getWallet(userId, existingWallet.id, trx);
      }

      const [wallet] = await trx('wallets')
        .insert({
          user_id: userId,
          wallet_type: walletType,
          currency,
          status: 'active'
        })
        .returning('*');

      await trx('wallet_balances').insert({
        wallet_id: wallet.id,
        available_balance: 0,
        locked_balance: 0
      });

      return this.getWallet(userId, wallet.id, trx);
    });
  },

  // Retrieve a wallet and its balance.
  async getWallet(userId, walletId, connection = db) {
    const wallet = await connection('wallets as w')
      .join('wallet_balances as b', 'w.id', 'b.wallet_id')
      .select(
        'w.id',
        'w.user_id',
        'w.wallet_type',
        'w.currency',
        'w.status',
        'w.created_at',
        'b.available_balance',
        'b.locked_balance',
        'b.updated_at'
      )
      .where({
        'w.id': walletId,
        'w.user_id': userId
      })
      .first();

    if (!wallet) {
      throw createError('Wallet not found', 404);
    }

    return {
      ...wallet,
      available_balance: String(wallet.available_balance),
      locked_balance: String(wallet.locked_balance)
    };
  },

  // List all wallets belonging to a user.
  async getUserWallets(userId) {
    const wallets = await db('wallets as w')
      .join('wallet_balances as b', 'w.id', 'b.wallet_id')
      .select(
        'w.id',
        'w.wallet_type',
        'w.currency',
        'w.status',
        'b.available_balance',
        'b.locked_balance',
        'w.created_at'
      )
      .where('w.user_id', userId)
      .orderBy('w.created_at', 'asc');

    return wallets.map((wallet) => ({
      ...wallet,
      available_balance: String(wallet.available_balance),
      locked_balance: String(wallet.locked_balance)
    }));
  },

  // Retrieve ledger history for a particular wallet.
  async getWalletTransactions(userId, walletId, limit = 20, offset = 0) {
    const wallet = await db('wallets')
      .where({ id: walletId, user_id: userId })
      .first();

    if (!wallet) {
      throw createError('Wallet not found', 404);
    }

    const entries = await db('ledger_entries as le')
      .join(
        'ledger_transactions as lt',
        'le.transaction_id',
        'lt.id'
      )
      .join(
        'financial_accounts as fa',
        'le.account_id',
        'fa.id'
      )
      .select(
        'lt.id as transaction_id',
        'lt.transaction_type',
        'lt.description',
        'lt.reference_type',
        'lt.reference_id',
        'lt.status',
        'lt.created_at',
        'lt.posted_at',
        'le.entry_type',
        'le.amount',
        'fa.account_code'
      )
      .where('le.wallet_id', walletId)
      .orderBy('lt.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return entries.map((entry) => ({
      ...entry,
      amount: String(entry.amount)
    }));
  }
};

module.exports = walletService;
