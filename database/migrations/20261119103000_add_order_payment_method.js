exports.up = async function (knex) {
  await knex.schema.alterTable('orders', (table) => {
    table.string('payment_method', 30).nullable();
  });

  await knex.raw(`
    ALTER TABLE orders
    ADD CONSTRAINT orders_payment_method_valid
    CHECK (
      payment_method IS NULL
      OR payment_method IN ('wallet', 'paystack')
    )
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_payment_method_valid
  `);

  await knex.schema.alterTable('orders', (table) => {
    table.dropColumn('payment_method');
  });
};
