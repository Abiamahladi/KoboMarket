const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { db } = require('../../src/config/postgres');

const {
  hashCheckoutRequest,
  claimCheckout
} = require('../../src/modules/checkout/checkout-idempotency.repository');

const runTest = async () => {
  let trx;

  try {
    const user = await db('users')
      .select('id')
      .first();

    assert.ok(user, 'A PostgreSQL user is required');

    const idempotencyKey = `test-${crypto.randomUUID()}`;

    const cart = {
      items: [
        {
          productId: crypto.randomUUID(),
          vendorId: crypto.randomUUID(),
          quantity: 2,
          priceKobo: 500000,
          currency: 'NGN'
        }
      ]
    };

    const requestHash = hashCheckoutRequest({
      userId: user.id,
      cart,
      shippingAddress: '123 Test Street, Lagos',
      paymentMethod: 'wallet'
    });

    assert.match(requestHash, /^[a-f0-9]{64}$/);

    console.log('PASS: Valid SHA-256 request hash');

    trx = await db.transaction();

    const first = await claimCheckout({
      userId: user.id,
      idempotencyKey,
      requestHash,
      transaction: trx
    });

    assert.equal(first.claimed, true);
    assert.equal(first.checkout.status, 'processing');

    console.log('PASS: First checkout claim accepted');

    const second = await claimCheckout({
      userId: user.id,
      idempotencyKey,
      requestHash,
      transaction: trx
    });

    assert.equal(second.claimed, false);
    assert.equal(second.checkout.id, first.checkout.id);

    console.log('PASS: Duplicate checkout claim rejected');

    const differentHash = hashCheckoutRequest({
      userId: user.id,
      cart,
      shippingAddress: '456 Different Street, Lagos',
      paymentMethod: 'wallet'
    });

    await assert.rejects(
      () => claimCheckout({
        userId: user.id,
        idempotencyKey,
        requestHash: differentHash,
        transaction: trx
      }),
      (error) => error.statusCode === 409
    );

    console.log('PASS: Different checkout details rejected');

    const records = await trx('checkout_requests')
      .where({
        user_id: user.id,
        idempotency_key: idempotencyKey
      });

    assert.equal(records.length, 1);

    console.log('PASS: Only one checkout request exists');

    await trx.rollback();
    trx = null;

    const remaining = await db('checkout_requests')
      .where({
        user_id: user.id,
        idempotency_key: idempotencyKey
      })
      .first();

    assert.equal(remaining, undefined);

    console.log('PASS: Test records rolled back');
    console.log('SUCCESS: Checkout idempotency integration test passed');

  } finally {
    if (trx && !trx.isCompleted()) {
      await trx.rollback();
    }

    await db.destroy();
  }
};

test('checkout idempotency integration', async () => {
  await runTest();
}, 60000);
