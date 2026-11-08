const express = require('express');
const authenticate = require('../../middleware/authenticate');

const router = express.Router();

// Get the currently authenticated user's profile
router.get('/me', authenticate, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'User profile retrieved successfully',
    data: {
      user: req.user
    }
  });
});

module.exports = router;
