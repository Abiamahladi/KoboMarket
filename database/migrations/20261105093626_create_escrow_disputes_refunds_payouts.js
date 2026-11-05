exports.up = async function (knex) {
  // 1. ESCROW
  // One escrow record per vendor order.
  // Partial releases and refunds are tracked separately.

  await knex.schema.createTable('escrows', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('vendor_order_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('vendor_orders')
      .onDelete('RESTRICT');

    table.uuid('payment_id')
      .notNullable()
      .references('id')
      .inTable('payments')
      .onDelete('RESTRICT');

    table.specificType('currency', 'CHAR(3)')
      .notNullable()
      .references('code')
      .inTable('currencies')
      .onDelete('RESTRICT');

    table.bigInteger('amount').notNullable();
    table.bigInteger('released_amount').notNullable().defaultTo(0);
    table.bigInteger('refunded_amount').notNullable().defaultTo(0);

    table.string('status', 30).notNullable().defaultTo('held');

    table.timestamp('held_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('released_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['status']);
    table.index(['payment_id']);
  });

  // 2. DISPUTES
  // A vendor order can have multiple disputes over its lifetime.

  await knex.schema.createTable('disputes', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('vendor_order_id')
      .notNullable()
      .references('id')
      .inTable('vendor_orders')
      .onDelete('RESTRICT');

    table.uuid('opened_by')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');

    table.string('reason', 100).notNullable();
    table.text('description').notNullable();

    table.string('status', 30).notNullable().defaultTo('open');

    table.text('resolution');
    table.uuid('resolved_by')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');

    table.timestamp('resolved_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['vendor_order_id']);
    table.index(['opened_by']);
    table.index(['status']);
  });

  // 3. REFUNDS
  // Supports multiple partial refunds against one payment.

  await knex.schema.createTable('refunds', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('payment_id')
      .notNullable()
      .references('id')
      .inTable('payments')
      .onDelete('RESTRICT');

    table.uuid('vendor_order_id')
      .references('id')
      .inTable('vendor_orders')
      .onDelete('RESTRICT');

    table.uuid('dispute_id')
      .references('id')
      .inTable('disputes')
      .onDelete('RESTRICT');

    table.specificType('currency', 'CHAR(3)')
      .notNullable()
      .references('code')
      .inTable('currencies')
      .onDelete('RESTRICT');

    table.bigInteger('amount').notNullable();

    table.string('reason', 255).notNullable();
    table.string('status', 30).notNullable().defaultTo('pending');

    table.string('provider_reference', 150).unique();
    table.string('idempotency_key', 150).notNullable().unique();

    table.uuid('created_by')
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');

    table.text('failure_reason');
    table.timestamp('processed_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['payment_id']);
    table.index(['vendor_order_id']);
    table.index(['dispute_id']);
    table.index(['status']);
  });

  // 4. VENDOR PAYOUTS
  // Multiple payouts are allowed for partial vendor settlements.

  await knex.schema.createTable('vendor_payouts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('vendor_order_id')
      .notNullable()
      .references('id')
      .inTable('vendor_orders')
      .onDelete('RESTRICT');

    table.uuid('escrow_id')
      .notNullable()
      .references('id')
      .inTable('escrows')
      .onDelete('RESTRICT');

    // Vendor ID comes from MongoDB.
    // It is intentionally not a PostgreSQL foreign key.

    table.uuid('vendor_id').notNullable();

    table.specificType('currency', 'CHAR(3)')
      .notNullable()
      .references('code')
      .inTable('currencies')
      .onDelete('RESTRICT');

    table.bigInteger('amount').notNullable();

    table.string('provider', 50).notNullable().defaultTo('paystack');
    table.string('provider_reference', 150).unique();

    table.string('status', 30).notNullable().defaultTo('pending');
    table.string('idempotency_key', 150).notNullable().unique();

    table.text('failure_reason');
    table.timestamp('paid_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['vendor_order_id']);
    table.index(['vendor_id']);
    table.index(['escrow_id']);
    table.index(['status']);
  });

  // 5. DATA VALIDATION CONSTRAINTS

  await knex.raw(`
    ALTER TABLE escrows
      ADD CONSTRAINT escrows_amount_positive
        CHECK (amount > 0),
      ADD CONSTRAINT escrows_released_nonnegative
        CHECK (released_amount >= 0),
      ADD CONSTRAINT escrows_refunded_nonnegative
        CHECK (refunded_amount >= 0),
      ADD CONSTRAINT escrows_settlement_limit
        CHECK (released_amount + refunded_amount <= amount),
      ADD CONSTRAINT escrows_status_valid
        CHECK (status IN (
          'held',
          'partially_released',
          'released',
          'partially_refunded',
          'refunded',
          'disputed'
        ));

    ALTER TABLE disputes
      ADD CONSTRAINT disputes_status_valid
        CHECK (status IN (
          'open',
          'under_review',
          'resolved',
          'rejected',
          'closed'
        ));

    ALTER TABLE refunds
      ADD CONSTRAINT refunds_amount_positive
        CHECK (amount > 0),
      ADD CONSTRAINT refunds_status_valid
        CHECK (status IN (
          'pending',
          'processing',
          'successful',
          'failed',
          'cancelled'
        ));

    ALTER TABLE vendor_payouts
      ADD CONSTRAINT vendor_payouts_amount_positive
        CHECK (amount > 0),
      ADD CONSTRAINT vendor_payouts_status_valid
        CHECK (status IN (
          'pending',
          'processing',
          'successful',
          'failed',
          'cancelled'
        ));
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('vendor_payouts');
  await knex.schema.dropTableIfExists('refunds');
  await knex.schema.dropTableIfExists('disputes');
  await knex.schema.dropTableIfExists('escrows');
};
