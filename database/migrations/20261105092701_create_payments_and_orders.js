
exports.up = async function (knex) {
  // 1. Customer orders.
  // One order represents one complete customer checkout.
  await knex.schema.createTable('orders', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.string('order_number', 50).notNullable().unique();

    table.uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');

    table.specificType('currency', 'CHAR(3)')
      .notNullable()
      .references('code')
      .inTable('currencies')
      .onDelete('RESTRICT');

    table.string('status', 30).notNullable().defaultTo('pending');

    // All amounts are stored in kobo for NGN.
    table.bigInteger('subtotal').notNullable();
    table.bigInteger('shipping_fee').notNullable().defaultTo(0);
    table.bigInteger('discount_amount').notNullable().defaultTo(0);
    table.bigInteger('total_amount').notNullable();

    table.text('shipping_address').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['user_id', 'created_at']);
    table.index(['status', 'created_at']);
  });

  // 2. Vendor orders.
  // One customer order can contain several vendor orders.
  await knex.schema.createTable('vendor_orders', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('order_id')
      .notNullable()
      .references('id')
      .inTable('orders')
      .onDelete('RESTRICT');

    // Vendor ID refers to a vendor record in MongoDB.
    table.uuid('vendor_id').notNullable();

    table.string('status', 30).notNullable().defaultTo('pending');

    table.specificType('currency', 'CHAR(3)')
      .notNullable()
      .references('code')
      .inTable('currencies')
      .onDelete('RESTRICT');

    table.bigInteger('subtotal').notNullable();
    table.bigInteger('shipping_fee').notNullable().defaultTo(0);
    table.bigInteger('total_amount').notNullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['order_id', 'vendor_id']);
    table.index(['vendor_id', 'status']);
    table.index(['order_id']);
  });

  // 3. Order items.
  // Product details are stored as snapshots so that future
  // catalogue changes do not alter historical purchases.
  await knex.schema.createTable('order_items', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('vendor_order_id')
      .notNullable()
      .references('id')
      .inTable('vendor_orders')
      .onDelete('RESTRICT');

    // Product ID refers to a product record in MongoDB.
    table.uuid('product_id').notNullable();

    table.string('product_name', 200).notNullable();
    table.string('product_sku', 100).nullable();

    table.integer('quantity').notNullable();

    // Price at the time of purchase, stored in kobo.
    table.bigInteger('unit_price').notNullable();
    table.bigInteger('line_total').notNullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['vendor_order_id']);
    table.index(['product_id']);
  });

  // 4. Payments.
  // An order can have multiple payment attempts.
  await knex.schema.createTable('payments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('order_id')
      .notNullable()
      .references('id')
      .inTable('orders')
      .onDelete('RESTRICT');

    table.string('provider', 30).notNullable().defaultTo('paystack');

    table.string('provider_reference', 150).nullable().unique();

    table.string('payment_method', 30).nullable();

    table.specificType('currency', 'CHAR(3)')
      .notNullable()
      .references('code')
      .inTable('currencies')
      .onDelete('RESTRICT');

    table.bigInteger('amount').notNullable();

    table.string('status', 30).notNullable().defaultTo('pending');

    // Prevent duplicate payment initiation requests.
    table.string('idempotency_key', 150).notNullable().unique();

    table.text('authorization_url').nullable();

    table.timestamp('paid_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['order_id', 'status']);
    table.index(['provider', 'created_at']);
  });

  // 5. Payment webhook events.
  // Records notifications received from Paystack.
  await knex.schema.createTable('payment_webhook_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.string('provider', 30).notNullable().defaultTo('paystack');
    table.string('provider_event_id', 150).notNullable();
    table.string('event_type', 100).notNullable();

    table.uuid('payment_id')
      .nullable()
      .references('id')
      .inTable('payments')
      .onDelete('RESTRICT');

    // Store the original webhook payload for auditing and troubleshooting.
    table.jsonb('payload').notNullable();

    table.boolean('signature_verified').notNullable().defaultTo(false);

    table.string('processing_status', 20).notNullable().defaultTo('pending');

    table.text('processing_error').nullable();

    table.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('processed_at', { useTz: true }).nullable();

    // A provider event must not be processed twice.
    table.unique(['provider', 'provider_event_id']);

    table.index(['payment_id']);
    table.index(['processing_status', 'received_at']);
  });

  // 6. Data integrity constraints.
  await knex.raw(`
    ALTER TABLE orders
    ADD CONSTRAINT orders_status_valid
    CHECK (status IN (
      'pending',
      'confirmed',
      'processing',
      'partially_fulfilled',
      'fulfilled',
      'cancelled',
      'completed'
    ));

    ALTER TABLE orders
    ADD CONSTRAINT orders_amounts_valid
    CHECK (
      subtotal >= 0
      AND shipping_fee >= 0
      AND discount_amount >= 0
      AND total_amount >= 0
      AND total_amount = subtotal + shipping_fee - discount_amount
    );

    ALTER TABLE vendor_orders
    ADD CONSTRAINT vendor_orders_status_valid
    CHECK (status IN (
      'pending',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'completed'
    ));

    ALTER TABLE vendor_orders
    ADD CONSTRAINT vendor_orders_amounts_valid
    CHECK (
      subtotal >= 0
      AND shipping_fee >= 0
      AND total_amount = subtotal + shipping_fee
    );

    ALTER TABLE order_items
    ADD CONSTRAINT order_items_quantity_valid
    CHECK (quantity > 0);

    ALTER TABLE order_items
    ADD CONSTRAINT order_items_amounts_valid
    CHECK (unit_price >= 0 AND line_total >= 0);

    ALTER TABLE payments
    ADD CONSTRAINT payments_status_valid
    CHECK (status IN (
      'pending',
      'processing',
      'successful',
      'failed',
      'abandoned',
      'refunded'
    ));

    ALTER TABLE payments
    ADD CONSTRAINT payments_amount_positive
    CHECK (amount > 0);

    ALTER TABLE payment_webhook_events
    ADD CONSTRAINT payment_webhook_processing_status_valid
    CHECK (processing_status IN (
      'pending',
      'processing',
      'processed',
      'failed'
    ));
  `);
};

exports.down = async function (knex) {
  // Drop tables in reverse dependency order.
  await knex.schema.dropTableIfExists('payment_webhook_events');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('order_items');
  await knex.schema.dropTableIfExists('vendor_orders');
  await knex.schema.dropTableIfExists('orders');
};
