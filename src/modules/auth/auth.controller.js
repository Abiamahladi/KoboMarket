
const authService = require('./auth.service');
const passwordResetService = require('./password-reset.service');

const isInvalidRefreshTokenError = (error) => {
  const jwtErrors = [
    'JsonWebTokenError',
    'TokenExpiredError',
    'NotBeforeError'
  ];

  const sessionErrors = [
    'Invalid refresh token',
    'Refresh token is invalid or has already been used',
    'Session is already revoked or invalid'
  ];

  return (
    jwtErrors.includes(error.name) ||
    sessionErrors.includes(error.message)
  );
};

const authController = {
  async register(req, res, next) {
    try {
      const result = await authService.register(req.body);

      return res.status(201).json({
        success: true,
        message: 'Account created successfully',
        data: result
      });
    } catch (error) {
      if (error.message === 'Email address is already registered') {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);

      return res.status(200).json({
        success: true,
        message: 'Login successful',
        data: result
      });
    } catch (error) {
      if (error.message === 'Invalid email or password') {
        return res.status(401).json({
          success: false,
          message: error.message
        });
      }

      if (error.message === 'Your account is not active') {
        return res.status(403).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },

  async refresh(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refresh(refreshToken);

      return res.status(200).json({
        success: true,
        message: 'Tokens refreshed successfully',
        data: result
      });
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token'
        });
      }

      return next(error);
    }
  },

  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;
      await authService.logout(refreshToken);

      return res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or already revoked refresh token'
        });
      }

      return next(error);
    }
  },

  async requestPasswordReset(req, res, next) {
    try {
      const { email } = req.body;

      await passwordResetService.requestPasswordReset(email);

      return res.status(200).json({
        success: true,
        message: 'If an account exists with that email, password reset instructions will be sent.'
      });
    } catch (error) {
      return next(error);
    }
  },

  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;

      await passwordResetService.resetPassword(token, newPassword);

      return res.status(200).json({
        success: true,
        message: 'Password has been reset successfully. Please log in again.'
      });
    } catch (error) {
      if (error.message === 'Invalid or expired password reset token') {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  }
};

module.exports = authController;
