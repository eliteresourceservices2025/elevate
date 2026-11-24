CREATE TABLE "time"."makeup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"absence_date" date NOT NULL,
	"missed_minutes" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"made_up_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "makeup_status_chk" CHECK ("time"."makeup_requests"."status" in ('pending','approved','declined','cancelled')),
	CONSTRAINT "makeup_window_chk" CHECK ("time"."makeup_requests"."window_end" > "time"."makeup_requests"."window_start" and "time"."makeup_requests"."minutes" between 15 and 960 and "time"."makeup_requests"."missed_minutes" between 15 and 960),
	CONSTRAINT "makeup_reason_chk" CHECK (coalesce(length(trim("time"."makeup_requests"."reason")), 0) > 0)
);
--> statement-breakpoint
ALTER TABLE "time"."makeup_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."attendance_days" ADD COLUMN "makeup_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."makeup_requests" ADD CONSTRAINT "makeup_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "makeup_requests_employee_idx" ON "time"."makeup_requests" USING btree ("employee_id","window_start");--> statement-breakpoint
CREATE INDEX "makeup_requests_status_idx" ON "time"."makeup_requests" USING btree ("status","created_at");--> statement-breakpoint
-- At most one live (waiting or approved) make-up window can cover any moment of one person's time.
ALTER TABLE "time"."makeup_requests" ADD CONSTRAINT "makeup_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, tstzrange("window_start", "window_end") WITH &&) WHERE ("status" in ('pending','approved'));
