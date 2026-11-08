const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../../config/env');

// Generate access token
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      email: user.email,
      tokenType: 'access'
    },
    env.JWT_SECRET,
    {
      subject: user.id,
      expiresIn: env.JWT_EXPIRES_IN
    }
  );
};

// Generate refresh token with a unique session ID
const generateRefreshToken = (user) => {
  const tokenId = crypto.randomUUID();

  return jwt.sign(
    {
      tokenType: 'refresh'
    },
    env.JWT_REFRESH_SECRET,
    {
      subject: user.id,
      jwtid: tokenId,
      expiresIn: env.JWT_REFRESH_EXPIRES_IN
    }
  );
};

// Verify access token
const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, env.JWT_SECRET);

  if (decoded.tokenType !== 'access') {
    throw new Error('Invalid access token');
  }

  return decoded;
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);

  if (decoded.tokenType !== 'refresh' || !decoded.jti) {
    throw new Error('Invalid refresh token');
  }

  return decoded;
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
