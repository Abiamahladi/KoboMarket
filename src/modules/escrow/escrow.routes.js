const express = require('express');

const authenticate = require('../../middleware/authenticate');
const authorizePermission = require('../../middleware/authorize-permission');
const { releaseEscrow } = require('./escrow.service');

const router = express.Router();

// All escrow administration requires authentication.
router.use(authenticate);

// Release a delivered vendor order's escrow to its vendor wallet.
router.post(
  '/:vendorOrderId/release',
  authorizePermission('platform:manage'),
  async (req, res, next) => {
    try {
      const { vendorOrderId } = req.params;

      const result = await releaseEscrow({
        vendorOrderId,
        initiatedBy: req.user.id
      });

      return res.status(200).json({
        success: true,
        message: result.duplicate
          ? 'Escrow was already released'
          : 'Escrow released successfully',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
