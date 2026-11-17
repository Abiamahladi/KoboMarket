
const express = require('express');
const authenticate = require('../../middleware/authenticate');
const authorizeRole = require('../../middleware/authorize-role');
const walletController = require('./wallet.controller');

const router = express.Router();

router.use(authenticate);

// Create a wallet matching the user's assigned role.
router.post(
  '/',
  (req, res, next) => {
    const requestedRole = req.body.walletType;

    if (!['customer', 'vendor'].includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        message: 'Wallet type must be customer or vendor'
      });
    }

    return authorizeRole(requestedRole)(req, res, next);
  },
  walletController.createWallet
);

// Retrieve all wallets belonging to the authenticated user.
router.get('/', walletController.getWallets);

// Retrieve a specific wallet.
router.get('/:walletId', walletController.getWallet);

// Retrieve wallet transaction history.
router.get('/:walletId/transactions', walletController.getTransactions);

module.exports = router;
