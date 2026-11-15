const { db } = require('../../config/postgres');

const auditService = {
  /**
   * Record an auditable action in PostgreSQL.
   *
   * actorId: PostgreSQL users.id (same UUID as MongoDB userId).
   * actorType: user or system.
   */
  async log({
    actorId = null,
    actorType = 'user',
    action,
    resourceType,
    resourceId = null,
    oldValues = null,
    newValues = null,
    description = null,
    ipAddress = null,
    userAgent = null,
    requestId = null
  }) {
    if (!action || !resourceType) {
      throw new Error('Audit action and resource type are required');
    }

    if (!['user', 'system'].includes(actorType)) {
      throw new Error('Invalid audit actor type');
    }

    if (actorType === 'user' && !actorId) {
      throw new Error('User audit events require an actor ID');
    }

    if (actorType === 'system' && actorId !== null) {
      throw new Error('System audit events must not have a user actor ID');
    }

    const [auditRecord] = await db('audit_logs')
      .insert({
        actor_id: actorId,
        actor_type: actorType,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        old_values: oldValues,
        new_values: newValues,
        description,
        ip_address: ipAddress,
        user_agent: userAgent,
        request_id: requestId
      })
      .returning([
        'id',
        'actor_id',
        'actor_type',
        'action',
        'resource_type',
        'resource_id',
        'created_at'
      ]);

    return auditRecord;
  }
};

module.exports = auditService;
