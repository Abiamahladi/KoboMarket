
const walletService = require('./wallet.service');

const walletController = {
  async createWallet(req, res, next) {
    try {
      const { walletType, currency } = req.body;

      if (!req.user.roles.includes(walletType)) {
        return res.status(403).json({
          success: false,
          message: `You are not authorized to create a ${walletType} wallet`
        });
      }

      const wallet = await walletService.createWallet(
        req.user.id,
        walletType,
        currency || 'NGN'
      );

      return res.status(201).json({
        success: true,
        message: 'Wallet created or retrieved successfully',
        data: wallet
      });
    } catch (error) {
      next(error);
    }
  },

  async getWallets(req, res, next) {
    try {
      const wallets = await walletService.getUserWallets(req.user.id);

      return res.status(200).json({
        success: true,
        data: wallets
      });
    } catch (error) {
      next(error);
    }
  },

  async getWallet(req, res, next) {
    try {
      const wallet = await walletService.getWallet(
        req.user.id,
        req.params.walletId
      );

      return res.status(200).json({
        success: true,
        data: wallet
      });
    } catch (error) {
      next(error);
    }
  },

  async getTransactions(req, res, next) {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      if (!Number.isInteger(limit) || !Number.isInteger(offset)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid pagination parameters'
        });
      }

      const transactions = await walletService.getWalletTransactions(
        req.user.id,
        req.params.walletId,
        limit,
        offset
      );

      return res.status(200).json({
        success: true,
        data: transactions
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = walletController;
