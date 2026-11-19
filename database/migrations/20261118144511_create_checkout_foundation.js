
exports.up = async function (knex) {
  // ==========================================
  // 1. CHECKOUT REQUESTS
  // ==========================================
  // Prevents the same customer checkout request
  // from creating multiple orders.

  await knex.schema.createTable('checkout_requests', (table) => {
    table.uuid('id').primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('user_id').notNullable()
      .references('id').inTable('users')
      .onDelete('RESTRICT');

    table.string('idempotency_key', 150).notNullable();

    // Hash of the validated checkout request.
    table.string('request_hash', 64).notNullable();

    table.uuid('order_id')
      .references('id').inTable('orders')
      .onDelete('RESTRICT');

    table.string('status', 30).notNullable()
      .defaultTo('processing');

    table.text('last_error');

    table.timestamp('created_at', { useTz: true })
      .notNullable().defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable().defaultTo(knex.fn.now());

    table.unique(['user_id', 'idempotency_key']);
    table.index(['status', 'created_at']);
    table.index(['order_id']);
  });

  // ==========================================
  // 2. STOCK RESERVATIONS
  // ==========================================
  // Records stock reserved in MongoDB for
  // individual PostgreSQL order items.

  await knex.schema.createTable('stock_reservations', (table) => {
    table.uuid('id').primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('order_item_id').notNullable()
      .references('id').inTable('order_items')
      .onDelete('RESTRICT');

    table.uuid('product_id').notNullable();

    table.integer('quantity').notNullable();

    table.string('status', 30).notNullable()
      .defaultTo('pending');

    table.timestamp('expires_at', { useTz: true })
      .notNullable();

    table.timestamp('reserved_at', { useTz: true });
    table.timestamp('released_at', { useTz: true });
    table.timestamp('committed_at', { useTz: true });

    table.timestamp('created_at', { useTz: true })
      .notNullable().defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable().defaultTo(knex.fn.now());

    table.unique(['order_item_id']);
    table.index(['status', 'expires_at']);
    table.index(['product_id', 'status']);
  });

  // ==========================================
  // 3. DATABASE CONSTRAINTS
  // ==========================================

  await knex.raw(`
    ALTER TABLE checkout_requests
      ADD CONSTRAINT checkout_request_status_valid
        CHECK (status IN (
          'processing',
          'completed',
          'failed'
        )),
      ADD CONSTRAINT checkout_request_key_not_empty
        CHECK (length(trim(idempotency_key)) > 0),
      ADD CONSTRAINT checkout_request_hash_valid
        CHECK (request_hash ~ '^[0-9a-f]{64}$');

    ALTER TABLE stock_reservations
      ADD CONSTRAINT stock_reservation_status_valid
        CHECK (status IN (
          'pending',
          'reserved',
          'committed',
          'released',
          'failed'
        )),
      ADD CONSTRAINT stock_reservation_quantity_valid
        CHECK (quantity > 0),
      ADD CONSTRAINT stock_reservation_timestamps_valid
        CHECK (
          (status <> 'reserved' OR reserved_at IS NOT NULL)
          AND (status <> 'committed' OR committed_at IS NOT NULL)
          AND (status <> 'released' OR released_at IS NOT NULL)
        );
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('stock_reservations');
  await knex.schema.dropTableIfExists('checkout_requests');
};
