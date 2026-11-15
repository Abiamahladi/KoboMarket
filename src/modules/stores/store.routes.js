
const express = require('express');

const authenticate = require('../../middleware/authenticate');
const authorizeRole = require('../../middleware/authorize-role');
const storeService = require('./store.service');

const {
  validateCreateStore,
  validateUpdateStore
} = require('./store.validation');

const router = express.Router();

// Create a store.
router.post(
  '/',
  authenticate,
  authorizeRole('vendor'),
  validateCreateStore,
  async (req, res, next) => {
    try {
      const store = await storeService.create(
        req.user.id,
        req.body
      );

      return res.status(201).json({
        success: true,
        message: 'Store created successfully',
        data: {
          storeId: store.storeId,
          storeName: store.storeName,
          slug: store.slug,
          status: store.status
        }
      });
    } catch (error) {
      if (error.message.includes('already has a store') ||
          error.message.includes('already exists') ||
          error.message.includes('already in use')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }

      if (error.message.includes('approved vendors')) {
        return res.status(403).json({
          success: false,
          message: error.message
        });
      }

      next(error);
    }
  }
);

// Get the authenticated vendor's store.
router.get('/me', authenticate, authorizeRole('vendor'), async (req, res, next) => {
  try {
    const store = await storeService.getMyStore(req.user.id);

    return res.status(200).json({
      success: true,
      data: { store }
    });
  } catch (error) {
    if (
      error.message === 'Approved vendor account not found' ||
      error.message === 'Store not found'
    ) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    next(error);
  }
});

// Update the authenticated vendor's store.
router.patch(
  '/me',
  authenticate,
  authorizeRole('vendor'),
  validateUpdateStore,
  async (req, res, next) => {
    try {
      const store = await storeService.update(
        req.user.id,
        req.body
      );

      return res.status(200).json({
        success: true,
        message: 'Store updated successfully',
        data: { store }
      });
    } catch (error) {
      if (
        error.message === 'Approved vendor account not found' ||
        error.message === 'Active store not found'
      ) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      if (error.message.includes('already in use')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }

      next(error);
    }
  }
);

// Close the authenticated vendor's store.
router.patch(
  '/me/close',
  authenticate,
  authorizeRole('vendor'),
  async (req, res, next) => {
    try {
      const store = await storeService.close(req.user.id);

      return res.status(200).json({
        success: true,
        message: 'Store closed successfully',
        data: {
          storeId: store.storeId,
          status: store.status
        }
      });
    } catch (error) {
      if (
        error.message === 'Approved vendor account not found' ||
        error.message === 'Active store not found'
      ) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      next(error);
    }
  }
);

// Public store profile.
router.get('/public/:slug', async (req, res, next) => {
  try {
    const store = await storeService.getPublicStore(req.params.slug);

    return res.status(200).json({
      success: true,
      data: { store }
    });
  } catch (error) {
    if (error.message === 'Store not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    next(error);
  }
});

module.exports = router;
