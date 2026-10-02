CREATE TABLE "talent"."calendar_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"google_email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"needs_reconnect" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."calendar_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."interviews" ADD COLUMN "calendar_mode" text DEFAULT 'ics' NOT NULL;--> statement-breakpoint
ALTER TABLE "talent"."interviews" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "talent"."interviews" ADD COLUMN "meet_link" text;--> statement-breakpoint
ALTER TABLE "talent"."interviews" ADD COLUMN "calendar_user_id" uuid;--> statement-breakpoint
ALTER TABLE "talent"."calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."interviews" ADD CONSTRAINT "interviews_calendar_user_id_users_id_fk" FOREIGN KEY ("calendar_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."interviews" ADD CONSTRAINT "interviews_calendar_chk" CHECK ("talent"."interviews"."calendar_mode" in ('ics','google') and ("talent"."interviews"."calendar_mode" = 'ics' or ("talent"."interviews"."google_event_id" is not null and "talent"."interviews"."calendar_user_id" is not null)));