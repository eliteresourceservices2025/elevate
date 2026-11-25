ALTER TABLE "time"."schedules" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time"."schedules" ADD COLUMN "removed_by" uuid;--> statement-breakpoint
ALTER TABLE "time"."schedules" ADD COLUMN "changed_at" timestamp with time zone;--> statement-breakpoint
-- Several schedules per person (2026-11-25): any number at once, including several for the same client, as long as their hours never cross.
ALTER TABLE "time"."schedules" DROP CONSTRAINT "schedules_no_overlap";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "time"."schedules_hours_overlap"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A removed entry applies to nothing, so it can clash with nothing.
  IF NEW.removed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Another schedule of the same person, in the same zone, on overlapping dates and a shared weekday, whose hours cross these hours.
  IF EXISTS (
    SELECT 1 FROM "time"."schedules" o
    WHERE o.employee_id = NEW.employee_id
      AND o.id <> NEW.id
      AND o.removed_at IS NULL
      AND o.zone = NEW.zone
      AND o.weekdays && NEW.weekdays
      AND daterange(o.effective_from, coalesce(o.effective_to, 'infinity'::date) + 1) && daterange(NEW.effective_from, coalesce(NEW.effective_to, 'infinity'::date) + 1)
      AND (substr(NEW.start_time, 1, 2)::int * 60 + substr(NEW.start_time, 4, 2)::int)
          < (substr(o.end_time, 1, 2)::int * 60 + substr(o.end_time, 4, 2)::int + CASE WHEN o.end_time <= o.start_time THEN 1440 ELSE 0 END)
      AND (substr(o.start_time, 1, 2)::int * 60 + substr(o.start_time, 4, 2)::int)
          < (substr(NEW.end_time, 1, 2)::int * 60 + substr(NEW.end_time, 4, 2)::int + CASE WHEN NEW.end_time <= NEW.start_time THEN 1440 ELSE 0 END)
  ) THEN
    RAISE EXCEPTION 'schedule hours overlap another schedule of this person' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
