
const express = require('express');

const authenticate = require('../../middleware/authenticate');
const authorizePermission = require('../../middleware/authorize-permission');
const vendorService = require('./vendor.service');
const { validateRejection } = require('./vendor.validation');

const router = express.Router();

// All routes require administrator user-management permission.
router.use(authenticate);
router.use(authorizePermission('user:manage'));

// List vendor applications.
router.get('/applications', async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const applications = await vendorService.listApplications(status);

    return res.status(200).json({
      success: true,
      data: { applications }
    });
  } catch (error) {
    if (error.message === 'Invalid vendor application status') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    next(error);
  }
});

// Approve a vendor application.
router.patch('/applications/:vendorId/approve', async (req, res, next) => {
  try {
    const vendor = await vendorService.approve(
      req.params.vendorId,
      req.user.id,
      req
    );

    return res.status(200).json({
      success: true,
      message: 'Vendor application approved successfully',
      data: {
        vendorId: vendor.vendorId,
        businessName: vendor.businessName,
        status: vendor.status
      }
    });
  } catch (error) {
    if (error.message === 'Pending vendor application not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    next(error);
  }
});

// Reject a vendor application.
router.patch(
  '/applications/:vendorId/reject',
  validateRejection,
  async (req, res, next) => {
    try {
      const vendor = await vendorService.reject(
        req.params.vendorId,
        req.user.id,
        req.body.reason
      );

      return res.status(200).json({
        success: true,
        message: 'Vendor application rejected successfully',
        data: {
          vendorId: vendor.vendorId,
          businessName: vendor.businessName,
          status: vendor.status,
          rejectionReason: vendor.rejectionReason
        }
      });
    } catch (error) {
      if (error.message === 'Pending vendor application not found') {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      next(error);
    }
  }
);

module.exports = router;
