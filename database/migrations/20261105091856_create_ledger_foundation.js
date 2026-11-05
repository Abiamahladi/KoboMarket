
exports.up = async function (knex) {
  // 1. Ledger transactions.
  // Each record represents one financial event.
  await knex.schema.createTable('ledger_transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.string('transaction_type', 50).notNullable();
    table.text('description');

    table.specificType('currency', 'CHAR(3)')
      .notNullable()
      .references('code')
      .inTable('currencies')
      .onDelete('RESTRICT');

    // draft: being prepared
    // posted: successfully recorded in the ledger
    // reversed: reversed by another transaction
    table.string('status', 20).notNullable().defaultTo('draft');

    // Prevent duplicate financial operations.
    table.string('idempotency_key', 150).unique();

    // Optional reference to an external event or business record.
    table.string('reference_type', 50);
    table.string('reference_id', 150);

    // User who initiated the financial operation, when applicable.
    table.uuid('initiated_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');

    // Links a reversal transaction to the original transaction.
    table.uuid('reversal_of_id')
      .nullable()
      .unique()
      .references('id')
      .inTable('ledger_transactions')
      .onDelete('RESTRICT');

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('posted_at', { useTz: true }).nullable();

    table.index(['transaction_type', 'status']);
    table.index(['reference_type', 'reference_id']);
    table.index(['created_at']);
  });

  // 2. Ledger entries.
  // Each transaction can contain multiple debit and credit entries.
  await knex.schema.createTable('ledger_entries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('transaction_id')
      .notNullable()
      .references('id')
      .inTable('ledger_transactions')
      .onDelete('RESTRICT');

    table.uuid('account_id')
      .notNullable()
      .references('id')
      .inTable('financial_accounts')
      .onDelete('RESTRICT');

    // Identifies the individual wallet affected by an entry.
    // System accounts such as Paystack Clearing do not need a wallet_id.
    table.uuid('wallet_id')
      .nullable()
      .references('id')
      .inTable('wallets')
      .onDelete('RESTRICT');

    table.string('entry_type', 10).notNullable();

    // Amount is stored in the smallest currency unit (kobo for NGN).
    table.bigInteger('amount').notNullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['transaction_id']);
    table.index(['account_id']);
    table.index(['wallet_id']);
    table.index(['created_at']);
  });

  // 3. Data integrity constraints.
  await knex.raw(`
    ALTER TABLE ledger_transactions
    ADD CONSTRAINT ledger_transactions_status_valid
    CHECK (status IN ('draft', 'posted', 'reversed'));

    ALTER TABLE ledger_transactions
    ADD CONSTRAINT ledger_transactions_type_not_empty
    CHECK (length(trim(transaction_type)) > 0);

    ALTER TABLE ledger_entries
    ADD CONSTRAINT ledger_entries_type_valid
    CHECK (entry_type IN ('debit', 'credit'));

    ALTER TABLE ledger_entries
    ADD CONSTRAINT ledger_entries_amount_positive
    CHECK (amount > 0);
  `);
};

exports.down = async function (knex) {
  // Remove the dependent table first.
  await knex.schema.dropTableIfExists('ledger_entries');
  await knex.schema.dropTableIfExists('ledger_transactions');
};

