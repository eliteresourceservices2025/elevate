CREATE TABLE "time"."schedule_day_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"client_id" uuid,
	"off" boolean DEFAULT false NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"break_minutes" smallint DEFAULT 0 NOT NULL,
	"allotted_minutes_per_day" smallint,
	"zone" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "schedule_day_changes_times_chk" CHECK ("time"."schedule_day_changes"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "time"."schedule_day_changes"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "schedule_day_changes_break_chk" CHECK ("time"."schedule_day_changes"."break_minutes" between 0 and 240),
	CONSTRAINT "schedule_day_changes_allotted_chk" CHECK ("time"."schedule_day_changes"."allotted_minutes_per_day" is null or "time"."schedule_day_changes"."allotted_minutes_per_day" between 1 and 960)
);
--> statement-breakpoint
ALTER TABLE "time"."schedule_day_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."daily_hours" DROP CONSTRAINT "daily_hours_minutes_chk";--> statement-breakpoint
ALTER TABLE "time"."schedule_day_changes" ADD CONSTRAINT "schedule_day_changes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."schedule_day_changes" ADD CONSTRAINT "schedule_day_changes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_day_changes_employee_idx" ON "time"."schedule_day_changes" USING btree ("employee_id","date");--> statement-breakpoint
ALTER TABLE "time"."daily_hours" ADD CONSTRAINT "daily_hours_minutes_chk" CHECK ("time"."daily_hours"."minutes" between 0 and 960);