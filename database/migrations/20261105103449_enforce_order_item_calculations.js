/**
 * Enforce order-item financial calculations.
 *
 * All monetary amounts are stored in kobo (BIGINT).
 *
 * Example:
 * quantity   = 3
 * unit_price = 500000  (₦5,000)
 * line_total = 1500000 (₦15,000)
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('order_items', function (table) {
    table.check(
      'line_total = quantity::BIGINT * unit_price',
      [],
      'order_items_line_total_matches_quantity_and_price'
    );
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('order_items', function (table) {
    table.dropChecks(
      'order_items_line_total_matches_quantity_and_price'
    );
  });
};
