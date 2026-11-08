
const crypto = require('crypto');

const User = require('../users/user.model');
const { redis } = require('../../config/redis');
const env = require('../../config/env');
const emailService = require('../../services/email.service');
const sessionService = require('./session.service');

const RESET_TOKEN_PREFIX = 'kobomarket:auth:password-reset:';
const RESET_TOKEN_EXPIRY = 15 * 60;

const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const passwordResetService = {
  async requestPasswordReset(email) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({
      email: normalizedEmail,
      status: 'active'
    });

    if (!user) {
      return true;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = hashToken(resetToken);
    const redisKey = `${RESET_TOKEN_PREFIX}${hashedToken}`;

    await redis.set(
      redisKey,
      user.userId,
      'EX',
      RESET_TOKEN_EXPIRY,
      'NX'
    );

    const resetUrl = new URL(env.PASSWORD_RESET_URL);
    resetUrl.searchParams.set('token', resetToken);

    const escapeHtml = (value) => {
      return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]);
    };

    try {
      await emailService.sendEmail({
        to: user.email,
        subject: 'KoboMarket Password Reset',
        text: [
          `Hello ${user.firstName},`,
          '',
          'We received a request to reset your KoboMarket password.',
          '',
          `Use this link to reset your password: ${resetUrl.toString()}`,
          '',
          'This link expires in 15 minutes and can only be used once.',
          '',
          'If you did not request this reset, you can ignore this email.'
        ].join('\n'),
        html: `
          <h2>Password Reset</h2>
          <p>Hello ${escapeHtml(user.firstName)},</p>
          <p>We received a request to reset your KoboMarket password.</p>
          <p>
            <a href="${escapeHtml(resetUrl.toString())}">Reset your password</a>
          </p>
          <p>This link expires in 15 minutes and can only be used once.</p>
          <p>If you did not request this reset, ignore this email.</p>
        `
      });
    } catch (error) {
      await redis.del(redisKey);
      throw error;
    }

    return true;
  },

  async resetPassword(token, newPassword) {
    const hashedToken = hashToken(token);
    const redisKey = `${RESET_TOKEN_PREFIX}${hashedToken}`;

    const userId = await redis.getdel(redisKey);

    if (!userId) {
      throw new Error('Invalid or expired password reset token');
    }

    const user = await User.findOne({ userId });

    if (!user || user.status !== 'active') {
      throw new Error('Invalid or expired password reset token');
    }

    user.passwordHash = newPassword;
    await user.save();

    // Revoke all refresh sessions after the password changes.
    await sessionService.revokeAllSessionsForUser(userId);

    return true;
  }
};

module.exports = passwordResetService;
