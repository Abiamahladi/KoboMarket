
const User = require('../users/user.model');
const { ROLES, ROLE_VALUES } = require('./roles');
const auditService = require('../audit/audit.service');

const roleService = {
  /**
   * Grant a role to another user.
   */
  async grantRole({ actorId, targetUserId, role, request }) {
    this.validateRequest(actorId, targetUserId, role);

    const user = await User.findOne({ userId: targetUserId });

    if (!user) {
      throw new Error('User account not found');
    }

    const oldRoles = [...(user.roles || [])];

    if (oldRoles.includes(role)) {
      throw new Error(`User already has the ${role} role`);
    }

    const newRoles = [...oldRoles, role];

    user.roles = newRoles;
    await user.save();

    try {
      await auditService.log({
        actorId,
        actorType: 'user',
        action: 'user.role.granted',
        resourceType: 'user',
        resourceId: targetUserId,
        oldValues: { roles: oldRoles },
        newValues: { roles: newRoles },
        description: `Granted the ${role} role to a user`,
        ipAddress: request?.ip || null,
        userAgent: request?.get('user-agent') || null,
        requestId: request?.id || null
      });
    } catch (error) {
      // Attempt to restore the original roles if auditing fails.
      const rollback = await User.updateOne(
        { userId: targetUserId, roles: newRoles },
        { $set: { roles: oldRoles } }
      );

      if (rollback.modifiedCount !== 1) {
        throw new Error(
          'CRITICAL: Role was changed but audit logging failed, and automatic restoration could not be confirmed'
        );
      }

      throw new Error(
        `Role change was rolled back because audit logging failed: ${error.message}`
      );
    }

    return {
      userId: targetUserId,
      roles: newRoles
    };
  },

  /**
   * Revoke a role from another user.
   */
  async revokeRole({ actorId, targetUserId, role, request }) {
    this.validateRequest(actorId, targetUserId, role);

    const user = await User.findOne({ userId: targetUserId });

    if (!user) {
      throw new Error('User account not found');
    }

    const oldRoles = [...(user.roles || [])];

    if (!oldRoles.includes(role)) {
      throw new Error(`User does not have the ${role} role`);
    }

    if (role === ROLES.ADMIN) {
      const adminCount = await User.countDocuments({
        roles: ROLES.ADMIN,
        status: 'active'
      });

      if (adminCount <= 1) {
        throw new Error('Cannot revoke the last active administrator');
      }
    }

    const newRoles = oldRoles.filter(
      (existingRole) => existingRole !== role
    );

    user.roles = newRoles;
    await user.save();

    try {
      await auditService.log({
        actorId,
        actorType: 'user',
        action: 'user.role.revoked',
        resourceType: 'user',
        resourceId: targetUserId,
        oldValues: { roles: oldRoles },
        newValues: { roles: newRoles },
        description: `Revoked the ${role} role from a user`,
        ipAddress: request?.ip || null,
        userAgent: request?.get('user-agent') || null,
        requestId: request?.id || null
      });
    } catch (error) {
      // Attempt to restore the original roles if auditing fails.
      const rollback = await User.updateOne(
        { userId: targetUserId, roles: newRoles },
        { $set: { roles: oldRoles } }
      );

      if (rollback.modifiedCount !== 1) {
        throw new Error(
          'CRITICAL: Role was changed but audit logging failed, and automatic restoration could not be confirmed'
        );
      }

      throw new Error(
        `Role change was rolled back because audit logging failed: ${error.message}`
      );
    }

    return {
      userId: targetUserId,
      roles: newRoles
    };
  },

  /**
   * Validate role-management requests.
   */
  validateRequest(actorId, targetUserId, role) {
    if (!actorId || !targetUserId || !role) {
      throw new Error('Actor, target user and role are required');
    }

    if (actorId === targetUserId) {
      throw new Error('You cannot change your own roles');
    }

    if (!ROLE_VALUES.includes(role)) {
      throw new Error('Invalid role supplied');
    }
  }
};

module.exports = roleService;
