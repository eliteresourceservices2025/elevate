CREATE TABLE "ops"."invoice_number_floor" (
	"year" smallint NOT NULL,
	"is_test" boolean NOT NULL,
	"seq" integer NOT NULL,
	CONSTRAINT "invoice_number_floor_year_is_test_pk" PRIMARY KEY("year","is_test")
);
--> statement-breakpoint
ALTER TABLE "ops"."invoice_number_floor" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Added by hand (after the generated table). Void and replaced invoices can be deleted for good, and an invoice number is never used twice:
-- `ops.invoice_number_floor` remembers the highest number deleted for each year and series, and new numbers start above it.

-- The floor only ever goes up, and a row is never removed.
CREATE OR REPLACE FUNCTION ops.guard_invoice_number_floor() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'The invoice number floor cannot be removed';
  END IF;
  IF NEW.year IS DISTINCT FROM OLD.year OR NEW.is_test IS DISTINCT FROM OLD.is_test OR NEW.seq < OLD.seq THEN
    RAISE EXCEPTION 'The invoice number floor can only go up';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_number_floor_guard BEFORE UPDATE OR DELETE ON ops.invoice_number_floor FOR EACH ROW EXECUTE FUNCTION ops.guard_invoice_number_floor();
--> statement-breakpoint
CREATE TRIGGER invoice_number_floor_no_truncate BEFORE TRUNCATE ON ops.invoice_number_floor FOR EACH STATEMENT EXECUTE FUNCTION ops.reject_invoice_change();
--> statement-breakpoint
-- The delete function gains a third switch, p_retired: void and replaced invoices (real ones too). Nothing else changes about it.
DROP FUNCTION payroll.purge_archived_test_data(boolean, boolean);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payroll.purge_archived_test_data(p_runs boolean, p_invoices boolean, p_retired boolean DEFAULT false)
RETURNS TABLE (runs_deleted integer, invoices_deleted integer, runs_kept integer, invoices_kept integer)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  run_ids uuid[] := '{}';
  inv_ids uuid[] := '{}';
  blocked uuid[] := '{}';
  all_runs uuid[] := '{}';
  all_invs uuid[] := '{}';
  prev_runs integer;
  prev_blocked integer;
  new_blocked uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pay_runs'));
  -- Number allocation takes the same lock, so a number is never handed out while the floor is being raised.
  PERFORM pg_advisory_xact_lock(hashtext('invoices.number'));

  IF p_runs THEN
    SELECT coalesce(array_agg(r.id), '{}') INTO all_runs FROM payroll.pay_runs r WHERE r.archived_at IS NOT NULL AND (r.is_test OR r.status = 'cancelled');
  END IF;
  SELECT coalesce(array_agg(i.id), '{}') INTO all_invs
    FROM ops.invoices i
    WHERE (p_invoices AND i.is_test AND ops.invoice_last_kind(i.id) = 'archived') OR (p_retired AND ops.invoice_last_kind(i.id) IN ('voided', 'superseded'));
  run_ids := all_runs;

  LOOP
    prev_runs := cardinality(run_ids);
    prev_blocked := cardinality(blocked);
    SELECT coalesce(array_agg(i.id), '{}') INTO inv_ids
      FROM ops.invoices i
      WHERE NOT (i.id = ANY (blocked)) AND (
        (p_invoices AND i.is_test AND ops.invoice_last_kind(i.id) = 'archived')
        OR (p_retired AND ops.invoice_last_kind(i.id) IN ('voided', 'superseded'))
        OR (i.is_test AND i.run_id = ANY (run_ids) AND ops.invoice_last_kind(i.id) IN ('archived', 'superseded'))
      );
    -- A run stays when any invoice on it is not going.
    SELECT coalesce(array_agg(r), '{}') INTO run_ids FROM unnest(run_ids) AS r
      WHERE NOT EXISTS (SELECT 1 FROM ops.invoices i WHERE i.run_id = r AND NOT (i.id = ANY (inv_ids)));
    -- An invoice stays when an invoice that stays points to it as its replacement.
    SELECT coalesce(array_agg(DISTINCT e.replaced_by), '{}') INTO new_blocked
      FROM ops.invoice_events e
      WHERE e.replaced_by = ANY (inv_ids) AND NOT (e.invoice_id = ANY (inv_ids));
    blocked := blocked || new_blocked;
    EXIT WHEN cardinality(run_ids) = prev_runs AND cardinality(new_blocked) = 0;
    EXIT WHEN cardinality(run_ids) = prev_runs AND cardinality(blocked) = prev_blocked;
  END LOOP;

  -- A deleted REAL invoice leaves its number behind: the next one starts above it, so a number is never used twice.
  INSERT INTO ops.invoice_number_floor (year, is_test, seq)
    SELECT i.year, i.is_test, max(i.seq) FROM ops.invoices i WHERE i.id = ANY (inv_ids) AND NOT i.is_test GROUP BY i.year, i.is_test
    ON CONFLICT (year, is_test) DO UPDATE SET seq = greatest(ops.invoice_number_floor.seq, EXCLUDED.seq);

  PERFORM set_config('payroll.purge', 'on', true);

  DELETE FROM ops.invoice_events WHERE invoice_id = ANY (inv_ids);
  DELETE FROM ops.invoices WHERE id = ANY (inv_ids);
  DELETE FROM payroll.timesheet_imports WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_run_releases WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_run_signatures WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_change_log WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_payments WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_approvals WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_run_items WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_run_lines WHERE run_id = ANY (run_ids);
  DELETE FROM payroll.pay_runs WHERE id = ANY (run_ids);

  PERFORM set_config('payroll.purge', 'off', true);

  runs_deleted := cardinality(run_ids);
  invoices_deleted := cardinality(inv_ids);
  runs_kept := cardinality(all_runs) - cardinality(run_ids);
  invoices_kept := (SELECT count(*)::integer FROM unnest(all_invs) AS a WHERE NOT (a = ANY (inv_ids)));
  RETURN NEXT;
END;
$$;
