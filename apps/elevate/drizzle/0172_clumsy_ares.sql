ALTER TABLE "time"."clock_events" DROP CONSTRAINT "clock_events_source_chk";--> statement-breakpoint
ALTER TABLE "time"."clock_events" DROP CONSTRAINT "clock_events_correction_chk";--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ADD COLUMN "default_daily_cap_minutes" integer DEFAULT 480 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ADD COLUMN "default_break_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ADD COLUMN "auto_stop_warn_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."schedules" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "time"."schedules" ADD COLUMN "allotted_minutes_per_day" smallint;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN "daily_cap_minutes" smallint;--> statement-breakpoint
ALTER TABLE "time"."schedules" ADD CONSTRAINT "schedules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_source_chk" CHECK ("time"."clock_events"."source" in ('web','admin_correction','jibble','auto_stop'));--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_correction_chk" CHECK (("time"."clock_events"."source" in ('web','jibble','auto_stop')) or ("time"."clock_events"."correction_id" is not null and coalesce(length(trim("time"."clock_events"."correction_reason")), 0) > 0));--> statement-breakpoint
ALTER TABLE "time"."schedules" ADD CONSTRAINT "schedules_allotted_chk" CHECK ("time"."schedules"."allotted_minutes_per_day" is null or "time"."schedules"."allotted_minutes_per_day" between 1 and 960);--> statement-breakpoint
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_daily_cap_chk" CHECK ("daily_cap_minutes" is null or "daily_cap_minutes" between 1 and 960);--> statement-breakpoint
-- Strict time rules (2026-11-24): one schedule per client at a time (a schedule with no client counts as its own "client"), and hours that never overlap.
ALTER TABLE "time"."schedules" DROP CONSTRAINT "schedules_no_overlap";--> statement-breakpoint
ALTER TABLE "time"."schedules" ADD CONSTRAINT "schedules_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, coalesce("client_id", '00000000-0000-0000-0000-000000000000'::uuid) WITH =, daterange("effective_from", coalesce("effective_to", 'infinity'::date) + 1) WITH &&);--> statement-breakpoint
CREATE FUNCTION "time"."schedules_hours_overlap"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Another schedule of the same person, in the same zone, on overlapping dates and a shared weekday, whose hours cross these hours.
  IF EXISTS (
    SELECT 1 FROM "time"."schedules" o
    WHERE o.employee_id = NEW.employee_id
      AND o.id <> NEW.id
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
END $$;--> statement-breakpoint
CREATE TRIGGER "schedules_hours_overlap_trg" BEFORE INSERT OR UPDATE ON "time"."schedules" FOR EACH ROW EXECUTE FUNCTION "time"."schedules_hours_overlap"();
