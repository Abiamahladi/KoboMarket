
const User = require('../modules/users/user.model');
const { verifyAccessToken } = require('../modules/auth/token.service');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;

    try {
      decoded = verifyAccessToken(token);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: error.name === 'TokenExpiredError'
          ? 'Access token has expired'
          : 'Invalid access token'
      });
    }

    const user = await User.findOne({
      userId: decoded.sub
    }).select(
      'userId firstName lastName email roles status'
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account not found'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active'
      });
    }

    req.user = {
      id: user.userId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: user.roles || ['customer']
    };

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = authenticate;
