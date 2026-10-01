CREATE TABLE "time"."extra_hours_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending_lead' NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"original_window_start" timestamp with time zone,
	"original_window_end" timestamp with time zone,
	"minutes" integer NOT NULL,
	"contact_name" text NOT NULL,
	"reason" text NOT NULL,
	"after_the_fact" boolean DEFAULT false NOT NULL,
	"confirmed_by_phone" boolean DEFAULT false NOT NULL,
	"filed_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extra_hours_source_chk" CHECK ("time"."extra_hours_requests"."source" in ('va','client')),
	CONSTRAINT "extra_hours_status_chk" CHECK ("time"."extra_hours_requests"."status" in ('pending_lead','pending_confirm','approved','declined','cancelled')),
	CONSTRAINT "extra_hours_window_chk" CHECK ("time"."extra_hours_requests"."window_end" > "time"."extra_hours_requests"."window_start" and "time"."extra_hours_requests"."minutes" between 15 and 1440),
	CONSTRAINT "extra_hours_text_chk" CHECK (coalesce(length(trim("time"."extra_hours_requests"."reason")), 0) > 0 and coalesce(length(trim("time"."extra_hours_requests"."contact_name")), 0) > 0)
);
--> statement-breakpoint
ALTER TABLE "time"."extra_hours_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."attendance_days" ADD COLUMN "approved_extra_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ADD COLUMN "max_extra_minutes_per_day" integer DEFAULT 240 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ADD COLUMN "max_day_minutes" integer DEFAULT 720 NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."correction_evidence" ADD COLUMN "extra_request_id" uuid;--> statement-breakpoint
ALTER TABLE "time"."correction_evidence" ADD COLUMN "uploaded_by" uuid;--> statement-breakpoint
ALTER TABLE "time"."extra_hours_requests" ADD CONSTRAINT "extra_hours_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."extra_hours_requests" ADD CONSTRAINT "extra_hours_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extra_hours_employee_idx" ON "time"."extra_hours_requests" USING btree ("employee_id","window_start");--> statement-breakpoint
CREATE INDEX "extra_hours_status_idx" ON "time"."extra_hours_requests" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "time"."correction_evidence" ADD CONSTRAINT "correction_evidence_extra_request_id_extra_hours_requests_id_fk" FOREIGN KEY ("extra_request_id") REFERENCES "time"."extra_hours_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "correction_evidence_extra_idx" ON "time"."correction_evidence" USING btree ("extra_request_id");--> statement-breakpoint
ALTER TABLE "time"."correction_evidence" ADD CONSTRAINT "correction_evidence_one_parent_chk" CHECK (not ("time"."correction_evidence"."correction_id" is not null and "time"."correction_evidence"."extra_request_id" is not null));
--> statement-breakpoint
-- Two live requests for one person can never cover the same time (needs btree_gist, already installed).
ALTER TABLE "time"."extra_hours_requests" ADD CONSTRAINT "extra_hours_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, tstzrange("window_start", "window_end") WITH &&) WHERE ("status" in ('pending_lead', 'pending_confirm', 'approved'));
