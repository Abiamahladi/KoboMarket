/**
 * Enforce currency and relationship consistency.
 *
 * Monetary amounts are stored in kobo (BIGINT).
 * This file ensures related financial records:
 * - Use the same currency.
 * - Belong to the correct parent order.
 * - Reference the correct vendor order and escrow.
 */

exports.up = async function (knex) {
  // --------------------------------------------------
  // 1. Supporting composite unique constraints
  // --------------------------------------------------

  await knex.raw(`
    ALTER TABLE orders
    ADD CONSTRAINT orders_id_currency_unique
    UNIQUE (id, currency);

    ALTER TABLE vendor_orders
    ADD CONSTRAINT vendor_orders_id_currency_unique
    UNIQUE (id, currency);

    ALTER TABLE payments
    ADD CONSTRAINT payments_id_currency_unique
    UNIQUE (id, currency);

    ALTER TABLE escrows
    ADD CONSTRAINT escrows_id_currency_unique
    UNIQUE (id, currency);
  `);

  // --------------------------------------------------
  // 2. Currency consistency foreign keys
  // --------------------------------------------------

  await knex.raw(`
    ALTER TABLE vendor_orders
    ADD CONSTRAINT vendor_orders_order_currency_fk
    FOREIGN KEY (order_id, currency)
    REFERENCES orders (id, currency)
    ON DELETE RESTRICT;

    ALTER TABLE payments
    ADD CONSTRAINT payments_order_currency_fk
    FOREIGN KEY (order_id, currency)
    REFERENCES orders (id, currency)
    ON DELETE RESTRICT;

    ALTER TABLE escrows
    ADD CONSTRAINT escrows_vendor_order_currency_fk
    FOREIGN KEY (vendor_order_id, currency)
    REFERENCES vendor_orders (id, currency)
    ON DELETE RESTRICT;

    ALTER TABLE escrows
    ADD CONSTRAINT escrows_payment_currency_fk
    FOREIGN KEY (payment_id, currency)
    REFERENCES payments (id, currency)
    ON DELETE RESTRICT;

    ALTER TABLE refunds
    ADD CONSTRAINT refunds_payment_currency_fk
    FOREIGN KEY (payment_id, currency)
    REFERENCES payments (id, currency)
    ON DELETE RESTRICT;

    ALTER TABLE refunds
    ADD CONSTRAINT refunds_vendor_order_currency_fk
    FOREIGN KEY (vendor_order_id, currency)
    REFERENCES vendor_orders (id, currency)
    ON DELETE RESTRICT;

    ALTER TABLE vendor_payouts
    ADD CONSTRAINT vendor_payouts_vendor_order_currency_fk
    FOREIGN KEY (vendor_order_id, currency)
    REFERENCES vendor_orders (id, currency)
    ON DELETE RESTRICT;

    ALTER TABLE vendor_payouts
    ADD CONSTRAINT vendor_payouts_escrow_currency_fk
    FOREIGN KEY (escrow_id, currency)
    REFERENCES escrows (id, currency)
    ON DELETE RESTRICT;
  `);

  // --------------------------------------------------
  // 3. Escrow: payment and vendor order must share
  //    the same parent order.
  // --------------------------------------------------

  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_escrow_order_consistency()
    RETURNS TRIGGER AS $$
    DECLARE
      vendor_order_parent UUID;
      payment_parent UUID;
    BEGIN
      SELECT order_id
      INTO vendor_order_parent
      FROM vendor_orders
      WHERE id = NEW.vendor_order_id;

      SELECT order_id
      INTO payment_parent
      FROM payments
      WHERE id = NEW.payment_id;

      IF vendor_order_parent IS DISTINCT FROM payment_parent THEN
        RAISE EXCEPTION
          'Escrow payment and vendor order must belong to the same parent order';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER enforce_escrow_order_consistency_trigger
    BEFORE INSERT OR UPDATE ON escrows
    FOR EACH ROW
    EXECUTE FUNCTION enforce_escrow_order_consistency();
  `);

  // --------------------------------------------------
  // 4. Refund: payment and vendor order must share
  //    the same parent order, when vendor_order_id
  //    is supplied.
  // --------------------------------------------------

  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_refund_order_consistency()
    RETURNS TRIGGER AS $$
    DECLARE
      vendor_order_parent UUID;
      payment_parent UUID;
    BEGIN
      IF NEW.vendor_order_id IS NOT NULL THEN

        SELECT order_id
        INTO vendor_order_parent
        FROM vendor_orders
        WHERE id = NEW.vendor_order_id;

        SELECT order_id
        INTO payment_parent
        FROM payments
        WHERE id = NEW.payment_id;

        IF vendor_order_parent IS DISTINCT FROM payment_parent THEN
          RAISE EXCEPTION
            'Refund payment and vendor order must belong to the same parent order';
        END IF;

      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER enforce_refund_order_consistency_trigger
    BEFORE INSERT OR UPDATE ON refunds
    FOR EACH ROW
    EXECUTE FUNCTION enforce_refund_order_consistency();
  `);

  // --------------------------------------------------
  // 5. Vendor payout: escrow must belong to the same
  //    vendor order as the payout.
  // --------------------------------------------------

  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_payout_escrow_consistency()
    RETURNS TRIGGER AS $$
    DECLARE
      escrow_vendor_order UUID;
    BEGIN
      SELECT vendor_order_id
      INTO escrow_vendor_order
      FROM escrows
      WHERE id = NEW.escrow_id;

      IF escrow_vendor_order IS DISTINCT FROM NEW.vendor_order_id THEN
        RAISE EXCEPTION
          'Payout escrow must belong to the same vendor order';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER enforce_payout_escrow_consistency_trigger
    BEFORE INSERT OR UPDATE ON vendor_payouts
    FOR EACH ROW
    EXECUTE FUNCTION enforce_payout_escrow_consistency();
  `);
};

exports.down = async function (knex) {
  // --------------------------------------------------
  // 1. Remove relationship triggers and functions
  // --------------------------------------------------

  await knex.raw(`
    DROP TRIGGER IF EXISTS enforce_payout_escrow_consistency_trigger
    ON vendor_payouts;

    DROP TRIGGER IF EXISTS enforce_refund_order_consistency_trigger
    ON refunds;

    DROP TRIGGER IF EXISTS enforce_escrow_order_consistency_trigger
    ON escrows;

    DROP FUNCTION IF EXISTS enforce_payout_escrow_consistency();
    DROP FUNCTION IF EXISTS enforce_refund_order_consistency();
    DROP FUNCTION IF EXISTS enforce_escrow_order_consistency();
  `);

  // --------------------------------------------------
  // 2. Remove composite foreign keys
  // --------------------------------------------------

  await knex.raw(`
    ALTER TABLE vendor_payouts
    DROP CONSTRAINT IF EXISTS vendor_payouts_escrow_currency_fk;

    ALTER TABLE vendor_payouts
    DROP CONSTRAINT IF EXISTS vendor_payouts_vendor_order_currency_fk;

    ALTER TABLE refunds
    DROP CONSTRAINT IF EXISTS refunds_vendor_order_currency_fk;

    ALTER TABLE refunds
    DROP CONSTRAINT IF EXISTS refunds_payment_currency_fk;

    ALTER TABLE escrows
    DROP CONSTRAINT IF EXISTS escrows_payment_currency_fk;

    ALTER TABLE escrows
    DROP CONSTRAINT IF EXISTS escrows_vendor_order_currency_fk;

    ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_order_currency_fk;

    ALTER TABLE vendor_orders
    DROP CONSTRAINT IF EXISTS vendor_orders_order_currency_fk;
  `);

  // --------------------------------------------------
  // 3. Remove supporting composite unique constraints
  // --------------------------------------------------

  await knex.raw(`
    ALTER TABLE escrows
    DROP CONSTRAINT IF EXISTS escrows_id_currency_unique;

    ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_id_currency_unique;

    ALTER TABLE vendor_orders
    DROP CONSTRAINT IF EXISTS vendor_orders_id_currency_unique;

    ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_id_currency_unique;
  `);
};
