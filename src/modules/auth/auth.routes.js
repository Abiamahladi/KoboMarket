
const express = require('express');

const authController = require('./auth.controller');

const {
  registerSchema,
  loginSchema,
  refreshSchema,
  passwordResetRequestSchema,
  passwordResetSchema
} = require('./auth.validation');

const router = express.Router();

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.details.map((detail) => detail.message)
    });
  }

  req.body = value;
  next();
};

router.post('/register', validate(registerSchema), authController.register);

router.post('/login', validate(loginSchema), authController.login);

router.post('/refresh', validate(refreshSchema), authController.refresh);

router.post('/logout', validate(refreshSchema), authController.logout);

router.post(
  '/password-reset/request',
  validate(passwordResetRequestSchema),
  authController.requestPasswordReset
);

router.post(
  '/password-reset/confirm',
  validate(passwordResetSchema),
  authController.resetPassword
);

module.exports = router;
