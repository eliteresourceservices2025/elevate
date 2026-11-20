ALTER TABLE "payroll"."pay_runs" DROP CONSTRAINT "pay_runs_status_chk";--> statement-breakpoint
DROP INDEX "payroll"."pay_runs_period_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "pay_runs_period_idx" ON "payroll"."pay_runs" USING btree ("period_start","period_end") WHERE "payroll"."pay_runs"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ADD CONSTRAINT "pay_runs_status_chk" CHECK ("payroll"."pay_runs"."status" in ('draft','in_review','approved','paid','cancelled'));--> statement-breakpoint
-- A draft run may be cancelled (and nothing else may be). A cancelled run is frozen like a paid one and is never deleted; the freeze
-- trigger on lines and items already refuses any run that is not a draft.
CREATE OR REPLACE FUNCTION payroll.guard_run_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A pay run cannot be removed';
  END IF;
  IF OLD.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'A % run cannot change', OLD.status;
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('in_review', 'cancelled'))
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
