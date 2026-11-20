CREATE TABLE "time"."tracker_offline_notices" (
	"clock_in_event_id" uuid PRIMARY KEY NOT NULL,
	"noticed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."tracker_offline_notices" ENABLE ROW LEVEL SECURITY;