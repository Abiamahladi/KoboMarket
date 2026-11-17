
const crypto = require('crypto');
const { db } = require('../../config/postgres');
const env = require('../../config/env');
const ledgerService = require('../wallets/ledger.service');

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const paymentService = {
  async initializeWalletFunding({
    userId,
    email,
    walletId,
    amount,
    idempotencyKey
  }) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw createError('Amount must be a positive whole number in kobo');
    }

    if (!email || !walletId) {
      throw createError('Email and wallet ID are required');
    }

    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim().length < 8 ||
      idempotencyKey.length > 150
    ) {
      throw createError('A valid idempotency key is required');
    }

    if (!env.PAYSTACK_SECRET_KEY.startsWith('sk_test_')) {
      throw createError('Paystack is not configured with a test secret key', 500);
    }

    const wallet = await db('wallets')
      .where({
        id: walletId,
        user_id: userId,
        wallet_type: 'customer',
        currency: 'NGN',
        status: 'active'
      })
      .first();

    if (!wallet) {
      throw createError('Active customer NGN wallet not found', 404);
    }

    const payment = await db.transaction(async (trx) => {
      const existing = await trx('payments')
        .where({ idempotency_key: idempotencyKey.trim() })
        .forUpdate()
        .first();

      if (existing) {
        const sameRequest =
          existing.payment_type === 'wallet_funding' &&
          existing.wallet_id === walletId &&
          String(existing.amount) === String(amount) &&
          existing.currency === 'NGN';

        if (!sameRequest) {
          throw createError(
            'Idempotency key has already been used for a different payment',
            409
          );
        }

        if (existing.authorization_url) {
          return { ...existing, reused: true };
        }

        throw createError(
          'This payment is already being processed. Check its status before retrying.',
          409
        );
      }

      const reference = `KM-WF-${crypto.randomUUID()}`;

      const [created] = await trx('payments')
        .insert({
          order_id: null,
          wallet_id: walletId,
          payment_type: 'wallet_funding',
          provider: 'paystack',
          provider_reference: reference,
          currency: 'NGN',
          amount: String(amount),
          status: 'pending',
          idempotency_key: idempotencyKey.trim()
        })
        .returning('*');

      return { ...created, reused: false };
    });

    if (payment.reused) {
      return {
        paymentId: payment.id,
        reference: payment.provider_reference,
        authorizationUrl: payment.authorization_url,
        amount: String(payment.amount),
        currency: payment.currency,
        reused: true
      };
    }

    let response;

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
            amount,
            currency: 'NGN',
            reference: payment.provider_reference,
            metadata: {
              paymentId: payment.id,
              userId,
              walletId,
              paymentType: 'wallet_funding'
            }
          }),
          signal: AbortSignal.timeout(15000)
        }
      );
    } catch (error) {
      throw createError(
        'Unable to confirm Paystack initialization. Check payment status before retrying.',
        502
      );
    }

    let result;

    try {
      result = await response.json();
    } catch (error) {
      throw createError('Invalid response received from Paystack', 502);
    }

    if (!response.ok || !result.status || !result.data?.authorization_url) {
      await db('payments')
        .where({ id: payment.id, status: 'pending' })
        .update({
          status: 'failed',
          updated_at: db.fn.now()
        });

      throw createError(
        result.message || 'Paystack could not initialize this payment',
        502
      );
    }

    await db('payments')
      .where({ id: payment.id })
      .update({
        authorization_url: result.data.authorization_url,
        updated_at: db.fn.now()
      });

    return {
      paymentId: payment.id,
      reference: payment.provider_reference,
      authorizationUrl: result.data.authorization_url,
      amount: String(payment.amount),
      currency: payment.currency,
      reused: false
    };
  },

  async verifyWalletFunding({ userId, reference }) {
    if (!userId || !reference) {
      throw createError('User ID and payment reference are required');
    }

    if (!env.PAYSTACK_SECRET_KEY.startsWith('sk_test_')) {
      throw createError('Paystack test configuration is required', 500);
    }

    // Find the payment and confirm wallet ownership.
    const payment = await db('payments as p')
      .join('wallets as w', 'p.wallet_id', 'w.id')
      .select('p.*')
      .where({
        'p.provider_reference': reference,
        'p.payment_type': 'wallet_funding',
        'p.provider': 'paystack',
        'w.user_id': userId
      })
      .first();

    if (!payment) {
      throw createError('Wallet funding payment not found', 404);
    }

    // A previously credited payment must never be credited again.
    if (payment.status === 'successful') {
      return {
        reference,
        status: 'success',
        credited: true,
        duplicate: true
      };
    }

    if (payment.status !== 'pending') {
      throw createError('This payment is not available for verification', 409);
    }

    // Verify directly with Paystack.
    let response;

    try {
      response = await fetch(
        `${env.PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`
          },
          signal: AbortSignal.timeout(15000)
        }
      );
    } catch (error) {
      throw createError('Unable to reach Paystack verification service', 502);
    }

    let result;

    try {
      result = await response.json();
    } catch (error) {
      throw createError('Invalid response received from Paystack', 502);
    }

    if (!response.ok || !result.status || !result.data) {
      throw createError(
        result.message || 'Paystack verification failed',
        502
      );
    }

    const verified = result.data;

    // Match the transaction against our own payment record.
    if (
      verified.reference !== payment.provider_reference ||
      String(verified.amount) !== String(payment.amount) ||
      verified.currency !== payment.currency
    ) {
      throw createError('Paystack transaction details do not match our payment', 409);
    }

    // Do not credit abandoned, failed or pending transactions.
    if (verified.status !== 'success') {
      if (['abandoned', 'failed'].includes(verified.status)) {
        await db('payments')
          .where({ id: payment.id, status: 'pending' })
          .update({
            status: verified.status,
            updated_at: db.fn.now()
          });
      }

      return {
        reference,
        status: verified.status,
        credited: false,
        message: 'Payment has not been successfully completed'
      };
    }

    // Lock the payment record to prevent concurrent crediting.
    return db.transaction(async (trx) => {
      const lockedPayment = await trx('payments')
        .where({ id: payment.id })
        .forUpdate()
        .first();

      if (lockedPayment.status === 'successful') {
        return {
          reference,
          status: 'success',
          credited: true,
          duplicate: true
        };
      }

      if (lockedPayment.status !== 'pending') {
        throw createError('Payment status changed before crediting', 409);
      }

      // Confirm the wallet is still active and belongs to this customer.
      const wallet = await trx('wallets')
        .where({
          id: lockedPayment.wallet_id,
          user_id: userId,
          wallet_type: 'customer',
          currency: 'NGN',
          status: 'active'
        })
        .first();

      if (!wallet) {
        throw createError('Customer wallet is unavailable', 404);
      }

      // Retrieve the correct NGN financial accounts.
      const accounts = await trx('financial_accounts')
        .where({
          currency: 'NGN',
          is_active: true
        })
        .whereIn('account_code', [
          'PAYSTACK_CLEARING',
          'CUSTOMER_WALLET_LIABILITY'
        ]);

      const clearingAccount = accounts.find(
        (account) => account.account_code === 'PAYSTACK_CLEARING'
      );

      const customerLiabilityAccount = accounts.find(
        (account) => account.account_code === 'CUSTOMER_WALLET_LIABILITY'
      );

      if (!clearingAccount || !customerLiabilityAccount) {
        throw createError('Required NGN financial accounts are unavailable', 500);
      }

      // Post the balanced, idempotent ledger transaction.
      const ledgerResult = await ledgerService.postTransaction({
        transactionType: 'wallet_funding',
        description: `Paystack wallet funding: ${reference}`,
        currency: 'NGN',
        idempotencyKey: `paystack-wallet-funding:${lockedPayment.id}`,
        referenceType: 'payment',
        referenceId: lockedPayment.id,
        initiatedBy: userId,
        entries: [
          {
            accountId: clearingAccount.id,
            entryType: 'debit',
            amount: String(lockedPayment.amount)
          },
          {
            accountId: customerLiabilityAccount.id,
            walletId: lockedPayment.wallet_id,
            entryType: 'credit',
            amount: String(lockedPayment.amount)
          }
        ]
      });

      if (!['posted'].includes(ledgerResult.status)) {
        throw createError('Wallet funding ledger transaction was not posted', 500);
      }

      // Mark successful only after the ledger has posted.
      await trx('payments')
        .where({
          id: lockedPayment.id,
          status: 'pending'
        })
        .update({
          status: 'successful',
          paid_at: verified.paid_at
            ? new Date(verified.paid_at)
            : trx.fn.now(),
          updated_at: trx.fn.now()
        });

      return {
        paymentId: lockedPayment.id,
        reference,
        status: 'success',
        credited: true,
        duplicate: ledgerResult.duplicate,
        ledgerTransactionId: ledgerResult.transactionId,
        amount: String(lockedPayment.amount),
        currency: lockedPayment.currency
      };
    });
  }
};

module.exports = paymentService;
