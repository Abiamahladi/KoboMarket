
exports.up = async function (knex) {
  await knex.schema.alterTable('payments', (table) => {
    table.string('payment_type', 30).notNullable().defaultTo('order');
    table.uuid('wallet_id')
      .nullable()
      .references('id')
      .inTable('wallets')
      .onDelete('RESTRICT');

    table.index(['wallet_id', 'status']);
    table.index(['payment_type', 'created_at']);
  });

  await knex.raw(`
    ALTER TABLE payments
    ADD CONSTRAINT payments_target_valid
    CHECK (
      (
        payment_type = 'order'
        AND order_id IS NOT NULL
        AND wallet_id IS NULL
      )
      OR
      (
        payment_type = 'wallet_funding'
        AND order_id IS NULL
        AND wallet_id IS NOT NULL
      )
    );

    ALTER TABLE payments
    ADD CONSTRAINT payments_type_valid
    CHECK (payment_type IN ('order', 'wallet_funding'));
  `);

  // Wallet funding requires order_id to be nullable.
  await knex.schema.alterTable('payments', (table) => {
    table.uuid('order_id').nullable().alter();
  });
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_target_valid;

    ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_type_valid;
  `);

  await knex.schema.alterTable('payments', (table) => {
    table.dropIndex(['wallet_id', 'status']);
    table.dropIndex(['payment_type', 'created_at']);
    table.dropForeign(['wallet_id']);
    table.dropColumn('wallet_id');
    table.dropColumn('payment_type');
  });

  await knex.schema.alterTable('payments', (table) => {
    table.uuid('order_id').notNullable().alter();
  });
};
