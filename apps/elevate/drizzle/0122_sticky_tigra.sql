DROP INDEX "payroll"."pay_run_items_run_idx";--> statement-breakpoint
ALTER TABLE "payroll"."pay_lines" ADD COLUMN "payment_method" text DEFAULT 'remitly' NOT NULL;--> statement-breakpoint
CREATE INDEX "pay_run_items_run_idx" ON "payroll"."pay_run_items" USING btree ("run_id","employee_id","run_line_id","type","created_at");--> statement-breakpoint
ALTER TABLE "payroll"."pay_lines" ADD CONSTRAINT "pay_lines_fte_chk" CHECK ("payroll"."pay_lines"."fte" >= 0);--> statement-breakpoint
ALTER TABLE "payroll"."pay_lines" ADD CONSTRAINT "pay_lines_ends_chk" CHECK ("payroll"."pay_lines"."ends_on" is null or "payroll"."pay_lines"."ends_on" >= "payroll"."pay_lines"."effective_from");--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ADD CONSTRAINT "pay_runs_rate_chk" CHECK ("payroll"."pay_runs"."usd_rate_e4" is null or "payroll"."pay_runs"."usd_rate_e4" > 0);--> statement-breakpoint
ALTER TABLE "payroll"."pay_settings" ADD CONSTRAINT "pay_settings_divisor_chk" CHECK ("payroll"."pay_settings"."cutoff_divisor" > 0);--> statement-breakpoint
-- Runs are never removed, and the freeze check locks the run row (FOR SHARE) so an item cannot land in a run that a concurrent submit just froze.
CREATE OR REPLACE FUNCTION payroll.reject_frozen_run_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  run_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO run_status FROM payroll.pay_runs WHERE id = OLD.run_id FOR SHARE;
    IF run_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'The run is % and its lines and items are frozen', run_status;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO run_status FROM payroll.pay_runs WHERE id = NEW.run_id FOR SHARE;
    IF run_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'The run is % and its lines and items are frozen', run_status;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payroll.guard_run_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A pay run cannot be removed';
  END IF;
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'A paid run cannot change';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status = 'in_review')
    OR (OLD.status = 'in_review' AND NEW.status IN ('draft', 'approved'))
    OR (OLD.status = 'approved' AND NEW.status = 'paid')
  ) THEN
    RAISE EXCEPTION 'Run status cannot make the transition % to %', OLD.status, NEW.status;
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.usd_rate_e4 IS DISTINCT FROM OLD.usd_rate_e4
    OR NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
  ) THEN
    RAISE EXCEPTION 'The rate, settings and period can change only while the run is a draft';
  END IF;
  RETURN NEW;
END;
$$;