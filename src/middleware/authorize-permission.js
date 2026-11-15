
const { ROLE_PERMISSIONS } = require('../modules/authorization/roles');

const authorizePermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRoles = req.user.roles || [];

    // Collect permissions granted by all assigned roles.
    const userPermissions = new Set(
      userRoles.flatMap((role) => ROLE_PERMISSIONS[role] || [])
    );

    // The user must have every requested permission.
    const hasRequiredPermissions = requiredPermissions.every(
      (permission) => userPermissions.has(permission)
    );

    if (!hasRequiredPermissions) {
      return res.status(403).json({
        success: false,
        message: 'You do not have the required permission'
      });
    }

    next();
  };
};

module.exports = authorizePermission;
