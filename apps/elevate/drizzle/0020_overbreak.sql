CREATE TABLE "time"."overbreak_notices" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"minutes_over" integer NOT NULL,
	"noticed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."overbreak_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."attendance_days" ADD COLUMN "overbreak_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD COLUMN "planned_break_minutes" smallint;--> statement-breakpoint
ALTER TABLE "time"."overbreak_notices" ADD CONSTRAINT "overbreak_notices_event_id_clock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "time"."clock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_planned_chk" CHECK ("time"."clock_events"."planned_break_minutes" is null or ("time"."clock_events"."type" = 'break_start' and "time"."clock_events"."planned_break_minutes" in (15, 30, 60)));