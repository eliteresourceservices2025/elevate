ALTER TABLE "talent"."reviews" ADD COLUMN "waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent"."reviews" ADD COLUMN "waived_by" uuid;--> statement-breakpoint
ALTER TABLE "talent"."reviews" ADD COLUMN "waive_reason" text;--> statement-breakpoint
ALTER TABLE "talent"."reviews" ADD CONSTRAINT "reviews_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."reviews" ADD CONSTRAINT "reviews_waive_chk" CHECK (("talent"."reviews"."waived_at" is null and "talent"."reviews"."waived_by" is null and "talent"."reviews"."waive_reason" is null) or ("talent"."reviews"."waived_at" is not null and "talent"."reviews"."waived_by" is not null and length(btrim("talent"."reviews"."waive_reason")) >= 3));--> statement-breakpoint
-- A waived review does not move forward, and a review already shared with the person cannot be waived. (A waived review can be
-- restored by clearing the waiver; nothing else about a finished step changes.)
CREATE OR REPLACE FUNCTION talent.reviews_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- A review only moves forward: its identity never changes and each step, once set, stays set.
  IF NEW.cycle_id <> OLD.cycle_id OR NEW.employee_id <> OLD.employee_id OR NEW.milestone IS DISTINCT FROM OLD.milestone THEN
    RAISE EXCEPTION 'a review cannot be moved to another cycle or person';
  END IF;
  IF (OLD.self_submitted_at IS NOT NULL AND NEW.self_submitted_at IS DISTINCT FROM OLD.self_submitted_at)
     OR (OLD.lead_submitted_at IS NOT NULL AND NEW.lead_submitted_at IS DISTINCT FROM OLD.lead_submitted_at)
     OR (OLD.shared_at IS NOT NULL AND NEW.shared_at IS DISTINCT FROM OLD.shared_at)
     OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at) THEN
    RAISE EXCEPTION 'a finished review step cannot be changed';
  END IF;
  IF OLD.waived_at IS NULL AND NEW.waived_at IS NOT NULL AND OLD.shared_at IS NOT NULL THEN
    RAISE EXCEPTION 'a review that was shared cannot be waived';
  END IF;
  IF OLD.waived_at IS NOT NULL AND NEW.waived_at IS NOT NULL
     AND (NEW.self_submitted_at IS DISTINCT FROM OLD.self_submitted_at
          OR NEW.lead_submitted_at IS DISTINCT FROM OLD.lead_submitted_at
          OR NEW.calibrated_at IS DISTINCT FROM OLD.calibrated_at
          OR NEW.shared_at IS DISTINCT FROM OLD.shared_at
          OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at) THEN
    RAISE EXCEPTION 'a waived review cannot move forward';
  END IF;
  RETURN NEW;
END;
$$;
