const User = require('../modules/users/user.model');
const { verifyAccessToken } = require('../modules/auth/token.service');

const authenticate = async (req, res, next) => {
  try {
    // Read the Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Extract the access token
    const token = authHeader.split(' ')[1];

    // Verify the token
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

    // Confirm that the user still exists
    const user = await User.findOne({
      userId: decoded.sub
    }).select('userId firstName lastName email status');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account not found'
      });
    }

    // Check whether the account is active
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active'
      });
    }

    // Attach authenticated user information to the request
    req.user = {
      id: user.userId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email
    };

    next();

  } catch (error) {
    next(error);
  }
};

module.exports = authenticate;
