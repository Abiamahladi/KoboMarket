
const express = require('express');
const authenticate = require('../../middleware/authenticate');
const paymentController = require('./payment.controller');

const router = express.Router();

router.use(authenticate);

router.post(
  '/wallet-funding/initialize',
  paymentController.initializeWalletFunding
);

router.post(
  '/wallet-funding/verify',
  paymentController.verifyWalletFunding
);

module.exports = router;
