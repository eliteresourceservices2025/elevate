ALTER TABLE "payroll"."pay_lines" DROP CONSTRAINT "pay_lines_fte_chk";--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" DROP CONSTRAINT "pay_runs_rate_chk";--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_items" ADD COLUMN "item_key" uuid;--> statement-breakpoint
ALTER TABLE "payroll"."pay_lines" DROP COLUMN "fte";--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" DROP COLUMN "usd_rate_e4";--> statement-breakpoint
ALTER TABLE "payroll"."pay_settings" DROP COLUMN "extra_holiday_bp";--> statement-breakpoint
ALTER TABLE "payroll"."pay_settings" DROP COLUMN "holiday_bp";--> statement-breakpoint
-- The dollar rate no longer exists (Remitly applies its own rate), so the run guard stops watching it.
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
    NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
  ) THEN
    RAISE EXCEPTION 'The settings and period can change only while the run is a draft';
  END IF;
  RETURN NEW;
END;
$$;
