const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../users/user.model');
const { db } = require('../../config/postgres');
const env = require('../../config/env');

const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken
} = require('./token.service');

const sessionService = require('./session.service');

// Convert refresh-token expiry into seconds.
const getRefreshExpirySeconds = () => {
  const value = env.JWT_REFRESH_EXPIRES_IN;
  const match = /^(\d+)(s|m|h|d)$/.exec(value);

  if (!match) {
    throw new Error('Unsupported refresh-token expiry format');
  }

  const amount = Number(match[1]);

  const multipliers = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400
  };

  return amount * multipliers[match[2]];
};

// Issue access and refresh tokens and store the refresh session.
const issueTokens = async (user) => {
  const tokenUser = {
    id: user.userId,
    email: user.email
  };

  const accessToken = generateAccessToken(tokenUser);
  const refreshToken = generateRefreshToken(tokenUser);
  const decodedToken = jwt.decode(refreshToken);

  const sessionCreated = await sessionService.createSession(
    decodedToken.jti,
    user.userId,
    getRefreshExpirySeconds()
  );

  if (!sessionCreated) {
    throw new Error('Could not create authentication session');
  }

  return { accessToken, refreshToken };
};

const authService = {
  // Register a new user.
  async register(userData) {
    const {
      firstName,
      lastName,
      email,
      password
    } = userData;

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({
      email: normalizedEmail
    });

    if (existingUser) {
      throw new Error('Email address is already registered');
    }

    const userId = crypto.randomUUID();
    let user;

    try {
      user = await User.create({
        userId,
        firstName,
        lastName,
        email: normalizedEmail,
        passwordHash: password
      });

      await db('users').insert({
        id: userId
      });

    } catch (error) {
      if (user) {
        await User.deleteOne({ _id: user._id });
      }

      if (error.code === 11000) {
        throw new Error('Email address is already registered');
      }

      throw error;
    }

    const tokens = await issueTokens(user);

    return {
      user: {
        id: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      },
      ...tokens
    };
  },

  // Authenticate an existing user.
  async login(email, password) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({
      email: normalizedEmail
    }).select('+passwordHash');

    if (!user) {
      throw new Error('Invalid email or password');
    }

    const passwordMatches = await user.comparePassword(password);

    if (!passwordMatches) {
      throw new Error('Invalid email or password');
    }

    if (user.status !== 'active') {
      throw new Error('Your account is not active');
    }

    user.lastLoginAt = new Date();
    await user.save();

    const tokens = await issueTokens(user);

    return {
      user: {
        id: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      },
      ...tokens
    };
  },

  // Exchange a valid refresh token for a new token pair.
  async refresh(refreshToken) {
    const decoded = verifyRefreshToken(refreshToken);

    const user = await User.findOne({
      userId: decoded.sub
    }).select('userId email status');

    if (!user || user.status !== 'active') {
      throw new Error('User account is not active');
    }

    const tokenUser = {
      id: user.userId,
      email: user.email
    };

    const newAccessToken = generateAccessToken(tokenUser);
    const newRefreshToken = generateRefreshToken(tokenUser);

    const newDecodedToken = jwt.decode(newRefreshToken);

    // Atomically replace the old Redis session with the new one.
    const rotated = await sessionService.rotateSession(
      decoded.jti,
      newDecodedToken.jti,
      user.userId,
      getRefreshExpirySeconds()
    );

    if (!rotated) {
      throw new Error('Refresh token is invalid or has already been used');
    }

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  },

  // Revoke the current refresh-token session.
  async logout(refreshToken) {
    const decoded = verifyRefreshToken(refreshToken);

    const revoked = await sessionService.revokeSession(decoded.jti);

    if (!revoked) {
      throw new Error('Session is already revoked or invalid');
    }

    return true;
  }
};

module.exports = authService;
