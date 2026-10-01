CREATE TABLE "time"."clock_presence" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."clock_presence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."correction_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"correction_id" uuid,
	"storage_path" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "correction_evidence_mime_chk" CHECK ("time"."correction_evidence"."mime" in ('image/jpeg','image/png'))
);
--> statement-breakpoint
ALTER TABLE "time"."correction_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."quiet_notices" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"noticed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."quiet_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."shift_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"session_event_id" uuid NOT NULL,
	"body" text NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_notes_body_chk" CHECK (char_length(trim("time"."shift_notes"."body")) between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "time"."shift_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."clock_corrections" ADD COLUMN "kind" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."clock_corrections" ADD COLUMN "original_proposed" jsonb;--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ADD COLUMN "eod_expected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."clock_presence" ADD CONSTRAINT "clock_presence_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."correction_evidence" ADD CONSTRAINT "correction_evidence_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."correction_evidence" ADD CONSTRAINT "correction_evidence_correction_id_clock_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "time"."clock_corrections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."quiet_notices" ADD CONSTRAINT "quiet_notices_event_id_clock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "time"."clock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."shift_notes" ADD CONSTRAINT "shift_notes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."shift_notes" ADD CONSTRAINT "shift_notes_session_event_id_clock_events_id_fk" FOREIGN KEY ("session_event_id") REFERENCES "time"."clock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "correction_evidence_path_idx" ON "time"."correction_evidence" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "correction_evidence_claim_idx" ON "time"."correction_evidence" USING btree ("correction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_notes_session_idx" ON "time"."shift_notes" USING btree ("session_event_id");--> statement-breakpoint
CREATE INDEX "shift_notes_employee_idx" ON "time"."shift_notes" USING btree ("employee_id","created_at");--> statement-breakpoint
ALTER TABLE "time"."clock_corrections" ADD CONSTRAINT "clock_corrections_kind_chk" CHECK ("time"."clock_corrections"."kind" in ('forgot','connection_problem','device_problem','other'));