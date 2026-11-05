
exports.up = async function (knex) {
  // PostgreSQL UUID generation support.
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  // 1. Supported currencies.
  await knex.schema.createTable('currencies', (table) => {
    table.specificType('code', 'CHAR(3)').primary();
    table.string('name', 50).notNullable();
    table.smallint('decimal_places').notNullable().defaultTo(2);
    table.boolean('is_enabled').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Initially, only Nigerian Naira is enabled.
  await knex('currencies').insert({
    code: 'NGN',
    name: 'Nigerian Naira',
    decimal_places: 2,
    is_enabled: true
  });

  // 2. External user references.
  // Actual user profiles will live in MongoDB.
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // 3. Chart of accounts.
  // These are the main accounting accounts used by KoboMarket.
  await knex.schema.createTable('financial_accounts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_code', 60).notNullable();
    table.string('account_name', 100).notNullable();
    table.string('account_type', 20).notNullable();
    table.specificType('currency', 'CHAR(3)')
      .notNullable()
      .references('code')
      .inTable('currencies')
      .onDelete('RESTRICT');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['account_code', 'currency']);
  });

  // 4. Customer and vendor wallets.
  await knex.schema.createTable('wallets', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');

    table.string('wallet_type', 20).notNullable();

    table.specificType('currency', 'CHAR(3)')
      .notNullable()
      .references('code')
      .inTable('currencies')
      .onDelete('RESTRICT');

    table.string('status', 20).notNullable().defaultTo('active');

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // A user cannot have duplicate wallets of the same type and currency.
    table.unique(['user_id', 'wallet_type', 'currency']);

    table.index(['user_id']);
    table.index(['currency', 'status']);
  });

  // 5. Wallet balance projections.
  await knex.schema.createTable('wallet_balances', (table) => {
    table.uuid('wallet_id')
      .primary()
      .references('id')
      .inTable('wallets')
      .onDelete('RESTRICT');

    // All amounts are stored in the smallest currency unit.
    // For NGN, 100 kobo = 1 naira.
    table.bigInteger('available_balance').notNullable().defaultTo(0);
    table.bigInteger('locked_balance').notNullable().defaultTo(0);

    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Data integrity constraints.
  await knex.raw(`
    ALTER TABLE currencies
    ADD CONSTRAINT currencies_code_format
    CHECK (code ~ '^[A-Z]{3}$');

    ALTER TABLE currencies
    ADD CONSTRAINT currencies_decimal_places_valid
    CHECK (decimal_places BETWEEN 0 AND 4);

    ALTER TABLE financial_accounts
    ADD CONSTRAINT financial_accounts_type_valid
    CHECK (account_type IN (
      'asset',
      'liability',
      'equity',
      'revenue',
      'expense'
    ));

    ALTER TABLE wallets
    ADD CONSTRAINT wallets_type_valid
    CHECK (wallet_type IN ('customer', 'vendor'));

    ALTER TABLE wallets
    ADD CONSTRAINT wallets_status_valid
    CHECK (status IN ('active', 'frozen', 'closed'));

    ALTER TABLE wallet_balances
    ADD CONSTRAINT wallet_balances_available_nonnegative
    CHECK (available_balance >= 0);

    ALTER TABLE wallet_balances
    ADD CONSTRAINT wallet_balances_locked_nonnegative
    CHECK (locked_balance >= 0);
  `);

  // Initial system accounting accounts for NGN.
  await knex('financial_accounts').insert([
    {
      account_code: 'PAYSTACK_CLEARING',
      account_name: 'Paystack Clearing Account',
      account_type: 'asset',
      currency: 'NGN'
    },
    {
      account_code: 'CUSTOMER_WALLET_LIABILITY',
      account_name: 'Customer Wallet Liability',
      account_type: 'liability',
      currency: 'NGN'
    },
    {
      account_code: 'VENDOR_WALLET_LIABILITY',
      account_name: 'Vendor Wallet Liability',
      account_type: 'liability',
      currency: 'NGN'
    },
    {
      account_code: 'ESCROW_LIABILITY',
      account_name: 'Escrow Liability',
      account_type: 'liability',
      currency: 'NGN'
    },
    {
      account_code: 'PLATFORM_REVENUE',
      account_name: 'Platform Revenue',
      account_type: 'revenue',
      currency: 'NGN'
    },
    {
      account_code: 'PLATFORM_EXPENSE',
      account_name: 'Platform Expense',
      account_type: 'expense',
      currency: 'NGN'
    }
  ]);
};

exports.down = async function (knex) {
  // Remove tables in reverse dependency order.
  await knex.schema.dropTableIfExists('wallet_balances');
  await knex.schema.dropTableIfExists('wallets');
  await knex.schema.dropTableIfExists('financial_accounts');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('currencies');

  // We deliberately leave pgcrypto installed because
  // other database objects may depend on it.
};
