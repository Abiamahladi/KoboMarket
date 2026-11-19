const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { db } = require('../../src/config/postgres');

const {
  withOrderLock
} = require('../../src/modules/checkout/checkout-order-lock');

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function runTest() {
  const orderId = crypto.randomUUID();

  let activeOperations = 0;
  let maximumConcurrentOperations = 0;

  const executionOrder = [];

  try {
    const operation = async (name) => {
      return withOrderLock(orderId, async () => {
        activeOperations++;

        maximumConcurrentOperations = Math.max(
          maximumConcurrentOperations,
          activeOperations
        );

        executionOrder.push(`${name}:start`);

        await sleep(150);

        executionOrder.push(`${name}:end`);

        activeOperations--;

        return name;
      });
    };

    const results = await Promise.all([
      operation('first'),
      operation('second')
    ]);

    assert.equal(results.length, 2);

    assert.equal(
      maximumConcurrentOperations,
      1,
      'Operations for the same order must not overlap'
    );

    assert.equal(executionOrder.length, 4);

    assert.ok(
      executionOrder[0].endsWith(':start')
    );

    assert.ok(
      executionOrder[1].endsWith(':end')
    );

    assert.ok(
      executionOrder[2].endsWith(':start')
    );

    assert.ok(
      executionOrder[3].endsWith(':end')
    );

    console.log('PASS: Both operations completed');
    console.log('PASS: Same-order operations did not overlap');
    console.log('PASS: PostgreSQL advisory lock serialized execution');

    console.log(
      'SUCCESS: Checkout order lock integration test passed'
    );
  } finally {
    await db.destroy();
  }
}

test('checkout order lock integration', async () => {
  await runTest();
}, 60000);
