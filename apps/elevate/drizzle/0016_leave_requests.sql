CREATE TABLE "time"."leave_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"level" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid,
	"note" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_approvals_level_chk" CHECK ("time"."leave_approvals"."level" in ('lead','hr')),
	CONSTRAINT "leave_approvals_decision_chk" CHECK ("time"."leave_approvals"."decision" in ('approved','declined','escalated'))
);
--> statement-breakpoint
ALTER TABLE "time"."leave_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"half_day" boolean DEFAULT false NOT NULL,
	"days" numeric(5, 2) NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"filed_by" uuid NOT NULL,
	"step_started_on" date NOT NULL,
	"reminded_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_status_chk" CHECK ("time"."leave_requests"."status" in ('pending_lead','pending_hr','approved','declined','cancelled')),
	CONSTRAINT "leave_requests_dates_chk" CHECK ("time"."leave_requests"."end_date" >= "time"."leave_requests"."start_date"),
	CONSTRAINT "leave_requests_days_chk" CHECK ("time"."leave_requests"."days" > 0),
	CONSTRAINT "leave_requests_half_chk" CHECK (not "time"."leave_requests"."half_day" or ("time"."leave_requests"."start_date" = "time"."leave_requests"."end_date" and "time"."leave_requests"."days" = 0.5))
);
--> statement-breakpoint
ALTER TABLE "time"."leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."email_queue" DROP CONSTRAINT "email_queue_kind_chk";--> statement-breakpoint
ALTER TABLE "ops"."email_queue" ADD COLUMN "attachment" jsonb;--> statement-breakpoint
ALTER TABLE "time"."leave_approvals" ADD CONSTRAINT "leave_approvals_request_id_leave_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "time"."leave_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "time"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_approvals_request_idx" ON "time"."leave_approvals" USING btree ("request_id","decided_at");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "time"."leave_requests" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "time"."leave_requests" USING btree ("status","step_started_on");--> statement-breakpoint
ALTER TABLE "ops"."email_queue" ADD CONSTRAINT "email_queue_kind_chk" CHECK ("ops"."email_queue"."kind" in ('ack_due','digest','invite'));