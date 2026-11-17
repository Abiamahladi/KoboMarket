
const paymentService = require('./payment.service');

const paymentController = {
  async initializeWalletFunding(req, res, next) {
    try {
      const { walletId, amountKobo } = req.body;
      const idempotencyKey = req.get('Idempotency-Key');

      if (!walletId || !amountKobo || !idempotencyKey) {
        return res.status(400).json({
          success: false,
          message: 'walletId, amountKobo and Idempotency-Key are required'
        });
      }

      if (!/^[1-9]\d*$/.test(String(amountKobo))) {
        return res.status(400).json({
          success: false,
          message: 'amountKobo must be a positive whole number'
        });
      }

      const amount = Number(amountKobo);

      if (!Number.isSafeInteger(amount)) {
        return res.status(400).json({
          success: false,
          message: 'Funding amount is too large'
        });
      }

      const payment = await paymentService.initializeWalletFunding({
        userId: req.user.id,
        email: req.user.email,
        walletId,
        amount,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: 'Payment initialized successfully',
        data: payment
      });
    } catch (error) {
      next(error);
    }
  },

  async verifyWalletFunding(req, res, next) {
    try {
      const { reference } = req.body;

      if (!reference || typeof reference !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Payment reference is required'
        });
      }

      const result = await paymentService.verifyWalletFunding({
        userId: req.user.id,
        reference
      });

      return res.status(200).json({
        success: true,
        message: 'Payment verification completed',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = paymentController;
