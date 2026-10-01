CREATE TABLE "time"."schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"weekdays" smallint[] NOT NULL,
	"break_minutes" smallint DEFAULT 0 NOT NULL,
	"zone" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_dates_chk" CHECK ("time"."schedules"."effective_to" is null or "time"."schedules"."effective_to" >= "time"."schedules"."effective_from"),
	CONSTRAINT "schedules_times_chk" CHECK ("time"."schedules"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "time"."schedules"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "schedules_weekdays_chk" CHECK (cardinality("time"."schedules"."weekdays") between 1 and 7 and "time"."schedules"."weekdays" <@ array[1,2,3,4,5,6,7]::smallint[]),
	CONSTRAINT "schedules_break_chk" CHECK ("time"."schedules"."break_minutes" between 0 and 240)
);
--> statement-breakpoint
ALTER TABLE "time"."schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."attendance_days" ADD COLUMN "scheduled_minutes" integer;--> statement-breakpoint
ALTER TABLE "time"."attendance_days" ADD COLUMN "late_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."attendance_days" ADD COLUMN "early_leave_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."attendance_days" ADD COLUMN "extra_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ADD COLUMN "late_grace_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."schedules" ADD CONSTRAINT "schedules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedules_employee_idx" ON "time"."schedules" USING btree ("employee_id","effective_from");--> statement-breakpoint
-- Two schedules for one person can never cover the same day (needs btree_gist, already installed for leave requests).
ALTER TABLE "time"."schedules" ADD CONSTRAINT "schedules_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, daterange("effective_from", coalesce("effective_to", 'infinity'::date) + 1) WITH &&);
