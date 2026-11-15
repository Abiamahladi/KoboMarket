

const express = require('express');
const authenticate = require('../../middleware/authenticate');

const router = express.Router();

router.get('/me', authenticate, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'User profile retrieved successfully',
    data: {
      user: {
        id: req.user.id,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        email: req.user.email,
        roles: req.user.roles
      }
    }
  });
});

module.exports = router;
