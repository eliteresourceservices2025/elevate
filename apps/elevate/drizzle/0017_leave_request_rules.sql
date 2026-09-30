-- Two live requests (pending or approved) for the same person may never cover the same day. The database enforces it,
-- so two requests made at the same moment cannot both get in. Needs btree_gist (supported on Supabase).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE time.leave_requests
  ADD CONSTRAINT leave_requests_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('pending_lead', 'pending_hr', 'approved'));
--> statement-breakpoint
-- Ledger rows made by a request point at it.
ALTER TABLE time.leave_ledger
  ADD CONSTRAINT leave_ledger_request_fk FOREIGN KEY (request_id) REFERENCES time.leave_requests (id);
--> statement-breakpoint
-- Approvals are evidence, like the ledger: never edited or removed.
CREATE OR REPLACE FUNCTION time.reject_leave_approval_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'time.leave_approvals is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER leave_approvals_no_update_delete
  BEFORE UPDATE OR DELETE ON time.leave_approvals
  FOR EACH ROW EXECUTE FUNCTION time.reject_leave_approval_change();
--> statement-breakpoint
CREATE TRIGGER leave_approvals_no_truncate
  BEFORE TRUNCATE ON time.leave_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION time.reject_leave_approval_change();
