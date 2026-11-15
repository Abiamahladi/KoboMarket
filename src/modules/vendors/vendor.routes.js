
const express = require('express');

const authenticate = require('../../middleware/authenticate');
const vendorService = require('./vendor.service');
const { validateApplication } = require('./vendor.validation');

const router = express.Router();

// Submit a vendor application.
router.post(
  '/apply',
  authenticate,
  validateApplication,
  async (req, res, next) => {
    try {
      const vendor = await vendorService.apply(
        req.user.id,
        req.body
      );

      return res.status(201).json({
        success: true,
        message: 'Vendor application submitted successfully',
        data: {
          vendorId: vendor.vendorId,
          businessName: vendor.businessName,
          status: vendor.status
        }
      });
    } catch (error) {
      if (
        error.message === 'User account not found' ||
        error.message === 'Your account is not active'
      ) {
        return res.status(403).json({
          success: false,
          message: error.message
        });
      }

      if (
        error.message.includes('already approved') ||
        error.message.includes('already exists')
      ) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }

      next(error);
    }
  }
);

// Check the authenticated user's vendor application.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const Vendor = require('./vendor.model');

    const vendor = await Vendor.findOne({
      userId: req.user.id
    }).lean();

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'No vendor application found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        vendorId: vendor.vendorId,
        businessName: vendor.businessName,
        status: vendor.status,
        reviewedAt: vendor.reviewedAt,
        rejectionReason: vendor.rejectionReason
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
