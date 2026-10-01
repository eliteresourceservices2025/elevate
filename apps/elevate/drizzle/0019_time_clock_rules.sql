-- Clock events are evidence of hours worked: nobody can edit or remove one, even with direct database access as
-- the owner role. A mistake is fixed by an approved correction, which is a new row.
CREATE OR REPLACE FUNCTION time.reject_clock_event_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'time.clock_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER clock_events_no_update_delete
  BEFORE UPDATE OR DELETE ON time.clock_events
  FOR EACH ROW EXECUTE FUNCTION time.reject_clock_event_change();
--> statement-breakpoint
CREATE TRIGGER clock_events_no_truncate
  BEFORE TRUNCATE ON time.clock_events
  FOR EACH STATEMENT EXECUTE FUNCTION time.reject_clock_event_change();
--> statement-breakpoint
-- Corrections point at the request that approved them.
ALTER TABLE time.clock_events
  ADD CONSTRAINT clock_events_correction_fk FOREIGN KEY (correction_id) REFERENCES time.clock_corrections (id);
