CREATE TABLE "time"."jibble_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_by" uuid,
	"paused_at" timestamp with time zone,
	CONSTRAINT "jibble_settings_single_chk" CHECK ("time"."jibble_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."jibble_link_log" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."jibble_link_log" ADD COLUMN "source" text DEFAULT 'event' NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."jibble_link_log" ADD COLUMN "fallback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."jibble_link_log" ADD CONSTRAINT "jibble_link_log_source_chk" CHECK ("time"."jibble_link_log"."source" in ('event','repair'));
--> statement-breakpoint
-- The one settings row (HR's pause switch).
INSERT INTO time.jibble_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
