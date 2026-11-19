/** @jest-environment node */

const env = require('../../src/config/env');

const {
  initializePaystackCheckout
} = require('../../src/modules/checkout/checkout-paystack.service');

describe('Paystack order checkout initialization', () => {
  test('rejects missing customer details', async () => {
    await expect(
      initializePaystackCheckout({
        userId: null,
        orderId: null,
        email: null
      })
    ).rejects.toThrow(
      'Valid user ID, order ID and email are required'
    );
  });

  test('rejects invalid email addresses', async () => {
    await expect(
      initializePaystackCheckout({
        userId: 'customer-123',
        orderId: 'order-123',
        email: 'invalid-email'
      })
    ).rejects.toThrow(
      'Valid user ID, order ID and email are required'
    );
  });

  test('rejects missing order ID', async () => {
    await expect(
      initializePaystackCheckout({
        userId: 'customer-123',
        orderId: null,
        email: 'customer@example.com'
      })
    ).rejects.toThrow(
      'Valid user ID, order ID and email are required'
    );
  });

  test('rejects a non-test Paystack secret key', async () => {
    const originalKey = env.PAYSTACK_SECRET_KEY;

    try {
      env.PAYSTACK_SECRET_KEY = 'sk_live_not_allowed';

      await expect(
        initializePaystackCheckout({
          userId: 'customer-123',
          orderId: 'order-123',
          email: 'customer@example.com'
        })
      ).rejects.toThrow(
        'Paystack test secret key is required'
      );
    } finally {
      env.PAYSTACK_SECRET_KEY = originalKey;
    }
  });
});
