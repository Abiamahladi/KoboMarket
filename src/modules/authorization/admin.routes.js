
const express = require('express');

const authenticate = require('../../middleware/authenticate');
const authorizePermission = require('../../middleware/authorize-permission');
const roleService = require('./role.service');

const router = express.Router();

// All admin routes require authentication and user-management permission.
router.use(authenticate);
router.use(authorizePermission('user:manage'));

// Grant a role to a user.
router.post('/users/:userId/roles', async (req, res, next) => {
  try {
    const { role } = req.body;

    const result = await roleService.grantRole({
      actorId: req.user.id,
      targetUserId: req.params.userId,
      role,
      request: req
    });

    return res.status(200).json({
      success: true,
      message: `${role} role granted successfully`,
      data: result
    });
  } catch (error) {
    if (error.message === 'User account not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    if (
      error.message.includes('already has') ||
      error.message.includes('required') ||
      error.message.includes('Invalid role') ||
      error.message.includes('cannot change your own roles')
    ) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    next(error);
  }
});

// Revoke a role from a user.
router.delete('/users/:userId/roles/:role', async (req, res, next) => {
  try {
    const result = await roleService.revokeRole({
      actorId: req.user.id,
      targetUserId: req.params.userId,
      role: req.params.role,
      request: req
    });

    return res.status(200).json({
      success: true,
      message: `${req.params.role} role revoked successfully`,
      data: result
    });
  } catch (error) {
    if (error.message === 'User account not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('last active administrator')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }

    if (
      error.message.includes('does not have') ||
      error.message.includes('required') ||
      error.message.includes('Invalid role') ||
      error.message.includes('cannot change your own roles')
    ) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    next(error);
  }
});

module.exports = router;
