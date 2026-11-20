-- Added by hand. The delete function can be limited to the runs and invoices a person ticked: p_only_runs and p_only_invoices (null means every
-- eligible one, as before). The rules about what may be deleted, the loop that keeps an invoice a kept invoice points to, and the number floor are
-- exactly as in 0135 and 0136. It now also returns the ids it deleted, so the app can say which ticked items were skipped.
DROP FUNCTION payroll.purge_archived_test_data(boolean, boolean, boolean);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payroll.purge_archived_test_data(
  p_runs boolean,
  p_invoices boolean,
  p_retired boolean DEFAULT false,
  p_only_runs uuid[] DEFAULT NULL,
  p_only_invoices uuid[] DEFAULT NULL
)
RETURNS TABLE (runs_deleted integer, invoices_deleted integer, runs_kept integer, invoices_kept integer, deleted_run_ids uuid[], deleted_invoice_ids uuid[])
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
  PERFORM pg_advisory_xact_lock(hashtext('invoices.number'));

  IF p_runs THEN
    SELECT coalesce(array_agg(r.id), '{}') INTO all_runs
      FROM payroll.pay_runs r
      WHERE r.archived_at IS NOT NULL AND (r.is_test OR r.status = 'cancelled') AND (p_only_runs IS NULL OR r.id = ANY (p_only_runs));
  END IF;
  SELECT coalesce(array_agg(i.id), '{}') INTO all_invs
    FROM ops.invoices i
    WHERE ((p_invoices AND i.is_test AND ops.invoice_last_kind(i.id) = 'archived') OR (p_retired AND ops.invoice_last_kind(i.id) IN ('voided', 'superseded')))
      AND (p_only_invoices IS NULL OR i.id = ANY (p_only_invoices));
  run_ids := all_runs;

  LOOP
    prev_runs := cardinality(run_ids);
    prev_blocked := cardinality(blocked);
    SELECT coalesce(array_agg(i.id), '{}') INTO inv_ids
      FROM ops.invoices i
      WHERE NOT (i.id = ANY (blocked)) AND (
        (p_invoices AND i.is_test AND ops.invoice_last_kind(i.id) = 'archived' AND (p_only_invoices IS NULL OR i.id = ANY (p_only_invoices)))
        OR (p_retired AND ops.invoice_last_kind(i.id) IN ('voided', 'superseded') AND (p_only_invoices IS NULL OR i.id = ANY (p_only_invoices)))
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
  deleted_run_ids := run_ids;
  deleted_invoice_ids := inv_ids;
  RETURN NEXT;
END;
$$;
