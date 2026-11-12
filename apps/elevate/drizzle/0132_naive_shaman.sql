DROP INDEX "payroll"."pay_runs_period_idx";--> statement-breakpoint
ALTER TABLE "ops"."invoices" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ADD CONSTRAINT "pay_runs_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_runs_period_idx" ON "payroll"."pay_runs" USING btree ("period_start","period_end") WHERE "payroll"."pay_runs"."status" <> 'cancelled' and not "payroll"."pay_runs"."is_test";--> statement-breakpoint
-- Added by hand: the run guard learns about test runs. A run can be marked as a test until it is paid; only a test run can be archived (any status,
-- paid included) and then nothing else about the run may change; a test run becomes a real run again only while it is a draft.
CREATE OR REPLACE FUNCTION payroll.guard_run_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A pay run cannot be removed';
  END IF;
  IF NEW.archived_at IS NOT NULL AND NOT NEW.is_test THEN
    RAISE EXCEPTION 'Only a test run can be archived';
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    IF NOT OLD.is_test OR NOT NEW.is_test THEN
      RAISE EXCEPTION 'Only a test run can be archived';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.is_test IS DISTINCT FROM OLD.is_test
      OR NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot
      OR NEW.period_start IS DISTINCT FROM OLD.period_start
      OR NEW.period_end IS DISTINCT FROM OLD.period_end
      OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
      RAISE EXCEPTION 'Archiving a run changes nothing else about it';
    END IF;
    RETURN NEW;
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
  IF NEW.is_test IS DISTINCT FROM OLD.is_test AND OLD.is_test AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'A test run can be made a real run again only while it is a draft';
  END IF;
  RETURN NEW;
END;
$$;
