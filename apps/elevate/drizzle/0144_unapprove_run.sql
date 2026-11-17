ALTER TABLE "payroll"."pay_approvals" DROP CONSTRAINT "pay_approvals_decision_chk";--> statement-breakpoint
ALTER TABLE "payroll"."pay_approvals" ADD CONSTRAINT "pay_approvals_decision_chk" CHECK ("payroll"."pay_approvals"."decision" in ('approved','sent_back','unapproved'));
--> statement-breakpoint
-- The run guard: an approved run may also go back to draft (unapprove), but never once a payment is recorded or statements are released.
CREATE OR REPLACE FUNCTION payroll.guard_run_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF payroll.purging() AND OLD.archived_at IS NOT NULL AND (OLD.is_test OR OLD.status = 'cancelled') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'A pay run cannot be removed';
  END IF;
  IF NEW.archived_at IS NOT NULL AND NOT NEW.is_test AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Only a test run or a cancelled run can be archived';
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    IF NOT ((OLD.is_test AND NEW.is_test) OR (OLD.status = 'cancelled' AND NEW.status = 'cancelled')) THEN
      RAISE EXCEPTION 'Only a test run or a cancelled run can be archived';
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
    OR (OLD.status = 'approved' AND NEW.status IN ('draft', 'paid'))
  ) THEN
    RAISE EXCEPTION 'Run status cannot make the transition % to %', OLD.status, NEW.status;
  END IF;
  -- An approved run goes back to draft (an Approver unapproves it) only before anything was paid or released: a recorded payment or released
  -- statements mean people already depend on it.
  IF OLD.status = 'approved' AND NEW.status = 'draft' AND (
    EXISTS (SELECT 1 FROM payroll.pay_payments WHERE run_id = OLD.id)
    OR EXISTS (SELECT 1 FROM payroll.pay_run_releases WHERE run_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'A run with recorded payments or released statements cannot be unapproved';
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
