CREATE TABLE "time"."tech_issue_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"reported_by" uuid NOT NULL,
	"kind" text NOT NULL,
	"happened_at" timestamp with time zone NOT NULL,
	"details" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"handling_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tech_issue_reports_kind_chk" CHECK ("time"."tech_issue_reports"."kind" in ('clock','jibble','internet_power','device','other')),
	CONSTRAINT "tech_issue_reports_status_chk" CHECK ("time"."tech_issue_reports"."status" in ('open','handled'))
);
--> statement-breakpoint
ALTER TABLE "time"."tech_issue_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."tech_issue_reports" ADD CONSTRAINT "tech_issue_reports_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tech_issue_reports_employee_idx" ON "time"."tech_issue_reports" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "tech_issue_reports_open_idx" ON "time"."tech_issue_reports" USING btree ("created_at") WHERE "time"."tech_issue_reports"."status" = 'open';