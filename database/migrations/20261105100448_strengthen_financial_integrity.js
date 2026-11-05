
exports.up = async function (knex) {
  // =====================================================
  // 1. CHECK THAT A POSTED LEDGER TRANSACTION BALANCES
  // =====================================================
  //
  // A valid transaction must:
  // - Have at least two entries.
  // - Have at least one debit and one credit.
  // - Have equal total debits and credits.
  // - Use accounts and wallets with matching currencies.
  //
  // The check runs at transaction commit time. This allows
  // all entries to be inserted before the transaction is
  // marked as posted.

  await knex.raw(`
    CREATE OR REPLACE FUNCTION assert_ledger_transaction_balanced(
      p_transaction_id UUID
    )
    RETURNS VOID
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_status VARCHAR(20);
      v_currency CHAR(3);
      v_entry_count BIGINT;
      v_debit_total NUMERIC;
      v_credit_total NUMERIC;
    BEGIN
      SELECT status, currency
      INTO v_status, v_currency
      FROM ledger_transactions
      WHERE id = p_transaction_id;

      -- Ignore missing or unposted transactions.
      IF NOT FOUND OR v_status NOT IN ('posted', 'reversed') THEN
        RETURN;
      END IF;

      SELECT
        COUNT(*),
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'debit'), 0),
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'credit'), 0)
      INTO
        v_entry_count,
        v_debit_total,
        v_credit_total
      FROM ledger_entries
      WHERE transaction_id = p_transaction_id;

      IF v_entry_count < 2 THEN
        RAISE EXCEPTION
          'Ledger transaction % must have at least two entries',
          p_transaction_id;
      END IF;

      IF v_debit_total = 0 OR v_credit_total = 0 THEN
        RAISE EXCEPTION
          'Ledger transaction % must contain debit and credit entries',
          p_transaction_id;
      END IF;

      IF v_debit_total <> v_credit_total THEN
        RAISE EXCEPTION
          'Unbalanced ledger transaction %. Debits: %, Credits: %',
          p_transaction_id,
          v_debit_total,
          v_credit_total;
      END IF;

      -- Every financial account must use the transaction currency.
      IF EXISTS (
        SELECT 1
        FROM ledger_entries e
        JOIN financial_accounts a ON a.id = e.account_id
        WHERE e.transaction_id = p_transaction_id
          AND a.currency <> v_currency
      ) THEN
        RAISE EXCEPTION
          'Ledger transaction % contains an account with a different currency',
          p_transaction_id;
      END IF;

      -- Every linked wallet must also use the transaction currency.
      IF EXISTS (
        SELECT 1
        FROM ledger_entries e
        JOIN wallets w ON w.id = e.wallet_id
        WHERE e.transaction_id = p_transaction_id
          AND w.currency <> v_currency
      ) THEN
        RAISE EXCEPTION
          'Ledger transaction % contains a wallet with a different currency',
          p_transaction_id;
      END IF;
    END;
    $$;
  `);

  // =====================================================
  // 2. VALIDATE LEDGER ENTRIES AT COMMIT TIME
  // =====================================================

  await knex.raw(`
    CREATE OR REPLACE FUNCTION check_ledger_entries_balance()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM assert_ledger_transaction_balanced(
          OLD.transaction_id
        );

      ELSIF TG_OP = 'UPDATE' THEN
        PERFORM assert_ledger_transaction_balanced(
          OLD.transaction_id
        );

        IF NEW.transaction_id <> OLD.transaction_id THEN
          PERFORM assert_ledger_transaction_balanced(
            NEW.transaction_id
          );
        END IF;

      ELSE
        PERFORM assert_ledger_transaction_balanced(
          NEW.transaction_id
        );
      END IF;

      RETURN NULL;
    END;
    $$;

    CREATE CONSTRAINT TRIGGER ledger_entries_balance_check
    AFTER INSERT OR UPDATE OR DELETE
    ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION check_ledger_entries_balance();
  `);

  // =====================================================
  // 3. VALIDATE WHEN A TRANSACTION IS POSTED
  // =====================================================

  await knex.raw(`
    CREATE OR REPLACE FUNCTION check_ledger_transaction_posting()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.status IN ('posted', 'reversed') THEN
        PERFORM assert_ledger_transaction_balanced(NEW.id);
      END IF;

      RETURN NULL;
    END;
    $$;

    CREATE CONSTRAINT TRIGGER ledger_transaction_posting_check
    AFTER UPDATE
    ON ledger_transactions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (NEW.status IN ('posted', 'reversed'))
    EXECUTE FUNCTION check_ledger_transaction_posting();
  `);

  // =====================================================
  // 4. PREVENT CHANGES TO POSTED LEDGER ENTRIES
  // =====================================================
  //
  // Financial history must not be edited after posting.
  // Corrections should use a separate reversal transaction.

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_posted_ledger_entry_changes()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_transaction_id UUID;
      v_status VARCHAR(20);
    BEGIN
      IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
        v_transaction_id := OLD.transaction_id;
      ELSE
        v_transaction_id := NEW.transaction_id;
      END IF;

      SELECT status
      INTO v_status
      FROM ledger_transactions
      WHERE id = v_transaction_id
      FOR UPDATE;

      IF v_status IN ('posted', 'reversed') THEN
        RAISE EXCEPTION
          'Cannot modify entries of posted or reversed ledger transaction %',
          v_transaction_id;
      END IF;

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;

      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER prevent_posted_ledger_entry_changes_trigger
    BEFORE INSERT OR UPDATE OR DELETE
    ON ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION prevent_posted_ledger_entry_changes();
  `);
};

exports.down = async function (knex) {
  // Remove triggers first.

  await knex.raw(`
    DROP TRIGGER IF EXISTS
      prevent_posted_ledger_entry_changes_trigger
      ON ledger_entries;

    DROP TRIGGER IF EXISTS
      ledger_transaction_posting_check
      ON ledger_transactions;

    DROP TRIGGER IF EXISTS
      ledger_entries_balance_check
      ON ledger_entries;
  `);

  // Remove the associated functions.

  await knex.raw(`
    DROP FUNCTION IF EXISTS prevent_posted_ledger_entry_changes();
    DROP FUNCTION IF EXISTS check_ledger_transaction_posting();
    DROP FUNCTION IF EXISTS check_ledger_entries_balance();
    DROP FUNCTION IF EXISTS assert_ledger_transaction_balanced(UUID);
  `);
};
