
exports.up = async function (knex) {
  // ==========================================
  // 1. OUTBOX EVENTS
  // ==========================================
  // Stores events that must be reliably delivered
  // to other services, databases or background workers.

  await knex.schema.createTable('outbox_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.string('event_type', 150).notNullable();

    table.string('aggregate_type', 100).notNullable();
    table.string('aggregate_id', 100).notNullable();

    table.jsonb('payload').notNullable();

    table.string('status', 30).notNullable().defaultTo('pending');

    table.integer('attempts').notNullable().defaultTo(0);
    table.integer('max_attempts').notNullable().defaultTo(10);

    table.text('last_error');

    table.timestamp('available_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('processed_at', { useTz: true });

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['status', 'available_at']);
    table.index(['aggregate_type', 'aggregate_id']);
    table.index(['created_at']);
  });

  // ==========================================
  // 2. AUDIT LOGS
  // ==========================================
  // Records important activities performed by
  // users, administrators and system processes.

  await knex.schema.createTable('audit_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('actor_id')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');

    table.string('actor_type', 30).notNullable().defaultTo('user');

    table.string('action', 150).notNullable();

    table.string('resource_type', 100).notNullable();
    table.string('resource_id', 100);

    table.jsonb('old_values');
    table.jsonb('new_values');

    table.text('description');

    table.string('ip_address', 45);
    table.text('user_agent');

    table.string('request_id', 100);

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['actor_id', 'created_at']);
    table.index(['action', 'created_at']);
    table.index(['resource_type', 'resource_id']);
    table.index(['request_id']);
    table.index(['created_at']);
  });

  // ==========================================
  // 3. VALIDATION CONSTRAINTS
  // ==========================================

  await knex.raw(`
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_event_status_valid
        CHECK (status IN (
          'pending',
          'processing',
          'processed',
          'failed',
          'dead_letter'
        )),
      ADD CONSTRAINT outbox_event_attempts_valid
        CHECK (attempts >= 0 AND max_attempts > 0),
      ADD CONSTRAINT outbox_event_type_not_empty
        CHECK (length(trim(event_type)) > 0),
      ADD CONSTRAINT outbox_aggregate_type_not_empty
        CHECK (length(trim(aggregate_type)) > 0),
      ADD CONSTRAINT outbox_aggregate_id_not_empty
        CHECK (length(trim(aggregate_id)) > 0);

    ALTER TABLE audit_logs
      ADD CONSTRAINT audit_actor_type_valid
        CHECK (actor_type IN (
          'user',
          'admin',
          'system'
        )),
      ADD CONSTRAINT audit_action_not_empty
        CHECK (length(trim(action)) > 0),
      ADD CONSTRAINT audit_resource_type_not_empty
        CHECK (length(trim(resource_type)) > 0);
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('outbox_events');
};
