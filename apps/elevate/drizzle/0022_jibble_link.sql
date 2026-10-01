CREATE TABLE "time"."jibble_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"jibble_minutes" integer NOT NULL,
	"elevate_minutes" integer NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"compared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."jibble_link_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"jibble_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "jibble_link_log_status_chk" CHECK ("time"."jibble_link_log"."status" in ('queued','sent','failed','skipped')),
	CONSTRAINT "jibble_link_log_action_chk" CHECK ("time"."jibble_link_log"."action" in ('In','Out','StartBreak','EndBreak'))
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_link_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."jibble_people" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"jibble_person_id" text NOT NULL,
	"matched_by" text NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jibble_people_matched_chk" CHECK ("time"."jibble_people"."matched_by" in ('email','manual'))
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ADD COLUMN "jibble_mirror" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."jibble_daily" ADD CONSTRAINT "jibble_daily_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."jibble_link_log" ADD CONSTRAINT "jibble_link_log_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."jibble_link_log" ADD CONSTRAINT "jibble_link_log_event_id_clock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "time"."clock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."jibble_people" ADD CONSTRAINT "jibble_people_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jibble_daily_unique_idx" ON "time"."jibble_daily" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "jibble_daily_date_idx" ON "time"."jibble_daily" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "jibble_link_log_event_idx" ON "time"."jibble_link_log" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "jibble_link_log_due_idx" ON "time"."jibble_link_log" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "jibble_link_log_employee_idx" ON "time"."jibble_link_log" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jibble_people_jibble_idx" ON "time"."jibble_people" USING btree ("jibble_person_id");