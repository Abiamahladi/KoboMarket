/** @jest-environment node */

jest.mock('../../src/modules/checkout/checkout-wallet-payment.service', () => ({
  payWithWallet: jest.fn()
}));

jest.mock('../../src/modules/checkout/checkout-stock-finalization.service', () => ({
  finalizeOrderStock: jest.fn()
}));

const {
  payWithWallet
} = require('../../src/modules/checkout/checkout-wallet-payment.service');

const {
  finalizeOrderStock
} = require('../../src/modules/checkout/checkout-stock-finalization.service');

const {
  completeWalletCheckout
} = require('../../src/modules/checkout/checkout-completion.service');

const request = {
  userId: 'test-user',
  orderId: 'test-order',
  walletId: 'test-wallet'
};

beforeEach(() => {
  jest.clearAllMocks();

  payWithWallet.mockResolvedValue({
    orderId: request.orderId,
    paymentId: 'test-payment',
    status: 'successful',
    duplicate: false
  });
});

describe('Complete wallet checkout', () => {
  test('finalizes stock after successful payment', async () => {
    finalizeOrderStock.mockResolvedValue({
      status: 'stock_committed',
      reservations: [
        { reservationId: 'reservation-1', status: 'committed' }
      ]
    });

    const result = await completeWalletCheckout(request);

    expect(result.status).toBe('successful');
    expect(result.stockStatus).toBe('stock_committed');
    expect(result.stockReservations).toBe(1);

    expect(payWithWallet).toHaveBeenCalledWith(request);
    expect(finalizeOrderStock).toHaveBeenCalledWith(request.orderId);
  });

  test('handles an already-paid checkout', async () => {
    payWithWallet.mockResolvedValue({
      orderId: request.orderId,
      paymentId: 'test-payment',
      status: 'successful',
      duplicate: true
    });

    finalizeOrderStock.mockResolvedValue({
      status: 'stock_committed',
      reservations: []
    });

    const result = await completeWalletCheckout(request);

    expect(result.duplicate).toBe(true);
    expect(result.stockStatus).toBe('stock_committed');
  });

  test('reports stock reconciliation without retrying payment', async () => {
    finalizeOrderStock.mockRejectedValue(
      new Error('MongoDB temporarily unavailable')
    );

    const result = await completeWalletCheckout(request);

    expect(result.status).toBe('successful');
    expect(result.stockStatus).toBe('reconciliation_required');
    expect(result.stockError).toBe('MongoDB temporarily unavailable');

    expect(payWithWallet).toHaveBeenCalledTimes(1);
    expect(finalizeOrderStock).toHaveBeenCalledTimes(1);
  });

  test('allows stock finalization to succeed on a later retry', async () => {
    finalizeOrderStock
      .mockRejectedValueOnce(new Error('Temporary database failure'))
      .mockResolvedValueOnce({
        status: 'stock_committed',
        reservations: [
          { reservationId: 'reservation-1', status: 'committed' }
        ]
      });

    const first = await completeWalletCheckout(request);

    expect(first.stockStatus).toBe('reconciliation_required');

    payWithWallet.mockResolvedValue({
      orderId: request.orderId,
      paymentId: 'test-payment',
      status: 'successful',
      duplicate: true
    });

    const second = await completeWalletCheckout(request);

    expect(second.duplicate).toBe(true);
    expect(second.stockStatus).toBe('stock_committed');
  });

  test('does not finalize stock when payment fails', async () => {
    payWithWallet.mockRejectedValue(
      new Error('Insufficient wallet balance')
    );

    await expect(
      completeWalletCheckout(request)
    ).rejects.toThrow('Insufficient wallet balance');

    expect(finalizeOrderStock).not.toHaveBeenCalled();
  });
});
