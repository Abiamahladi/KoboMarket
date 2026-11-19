/** @jest-environment node */

const crypto = require('node:crypto');
const { db } = require('../../src/config/postgres');
const ledgerService = require('../../src/modules/wallets/ledger.service');

jest.setTimeout(30000);

describe('Ledger transaction atomicity', () => {
  afterAll(async () => {
    await db.destroy();
  });

  test('rolls back ledger entries and wallet credit together', async () => {
    const [user] = await db('users')
      .insert({
        id: crypto.randomUUID()
      })
      .returning('id');

    const accounts = await db('financial_accounts')
      .where({ currency: 'NGN', is_active: true })
      .whereIn('account_code', [
        'PAYSTACK_CLEARING',
        'CUSTOMER_WALLET_LIABILITY'
      ]);

    const clearing = accounts.find(
      (account) => account.account_code === 'PAYSTACK_CLEARING'
    );

    const liability = accounts.find(
      (account) => account.account_code === 'CUSTOMER_WALLET_LIABILITY'
    );

    if (!clearing || !liability) {
      throw new Error('Required financial accounts are missing');
    }

    const idempotencyKey = `test-rollback-${crypto.randomUUID()}`;
    let transactionId;

    await expect(
      db.transaction(async (trx) => {
        // A temporary wallet exists only inside this transaction.
        const [wallet] = await trx('wallets')
          .insert({
            user_id: user.id,
            wallet_type: 'customer',
            currency: 'NGN',
            status: 'active'
          })
          .returning('*');

        await trx('wallet_balances').insert({
          wallet_id: wallet.id,
          available_balance: 0,
          locked_balance: 0
        });

        const result = await ledgerService.postTransaction({
          transactionType: 'wallet_funding',
          description: 'Atomic rollback integration test',
          currency: 'NGN',
          idempotencyKey,
          initiatedBy: user.id,
          transaction: trx,
          entries: [
            {
              accountId: clearing.id,
              entryType: 'debit',
              amount: '10000'
            },
            {
              accountId: liability.id,
              walletId: wallet.id,
              entryType: 'credit',
              amount: '10000'
            }
          ]
        });

        transactionId = result.transactionId;

        const balance = await trx('wallet_balances')
          .where({ wallet_id: wallet.id })
          .first();

        expect(String(balance.available_balance)).toBe('10000');

        // Simulate a payment-status update failure.
        throw new Error('SIMULATED_PAYMENT_UPDATE_FAILURE');
      })
    ).rejects.toThrow('SIMULATED_PAYMENT_UPDATE_FAILURE');

    const ledgerRecord = await db('ledger_transactions')
      .where({ idempotency_key: idempotencyKey })
      .first();

    const ledgerEntries = await db('ledger_entries')
      .where({ transaction_id: transactionId });

    expect(ledgerRecord).toBeUndefined();
    expect(ledgerEntries).toHaveLength(0);

    await db('users')
      .where({ id: user.id })
      .del();
  });
});
