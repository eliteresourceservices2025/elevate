CREATE TABLE "time"."attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."attendance_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."clock_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"proposed" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clock_corrections_status_chk" CHECK ("time"."clock_corrections"."status" in ('pending','approved','rejected','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "time"."clock_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."clock_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"ip" text,
	"outside_allowed_range" boolean DEFAULT false NOT NULL,
	"approx_lat" numeric(5, 2),
	"approx_lng" numeric(5, 2),
	"correction_id" uuid,
	"correction_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clock_events_type_chk" CHECK ("time"."clock_events"."type" in ('clock_in','break_start','break_end','clock_out')),
	CONSTRAINT "clock_events_source_chk" CHECK ("time"."clock_events"."source" in ('web','admin_correction')),
	CONSTRAINT "clock_events_correction_chk" CHECK (("time"."clock_events"."source" = 'web') or ("time"."clock_events"."correction_id" is not null and coalesce(length(trim("time"."clock_events"."correction_reason")), 0) > 0)),
	CONSTRAINT "clock_events_location_chk" CHECK (("time"."clock_events"."approx_lat" is null) = ("time"."clock_events"."approx_lng" is null))
);
--> statement-breakpoint
ALTER TABLE "time"."clock_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."clock_prefs" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"share_location" boolean DEFAULT false NOT NULL,
	"time_zone" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."clock_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."clock_rules" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"allowed_cidrs" text[] DEFAULT '{}'::text[] NOT NULL,
	"selfie_required" boolean DEFAULT false NOT NULL,
	"idle_minutes" integer DEFAULT 30,
	"grace_minutes" integer DEFAULT 60 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."clock_selfies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "time"."clock_selfies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."idle_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"prompted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"source" text NOT NULL,
	CONSTRAINT "idle_prompts_source_chk" CHECK ("time"."idle_prompts"."source" in ('idle_api','fallback'))
);
--> statement-breakpoint
ALTER TABLE "time"."idle_prompts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."missed_clockout_notices" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"noticed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."missed_clockout_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."attendance_days" ADD CONSTRAINT "attendance_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_corrections" ADD CONSTRAINT "clock_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_prefs" ADD CONSTRAINT "clock_prefs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_rules" ADD CONSTRAINT "clock_rules_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "core"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_selfies" ADD CONSTRAINT "clock_selfies_event_id_clock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "time"."clock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_selfies" ADD CONSTRAINT "clock_selfies_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."idle_prompts" ADD CONSTRAINT "idle_prompts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."missed_clockout_notices" ADD CONSTRAINT "missed_clockout_notices_event_id_clock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "time"."clock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_unique_idx" ON "time"."attendance_days" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_days_date_idx" ON "time"."attendance_days" USING btree ("date");--> statement-breakpoint
CREATE INDEX "clock_corrections_status_idx" ON "time"."clock_corrections" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "clock_corrections_employee_idx" ON "time"."clock_corrections" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "clock_events_employee_idx" ON "time"."clock_events" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clock_selfies_event_idx" ON "time"."clock_selfies" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clock_selfies_path_idx" ON "time"."clock_selfies" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "clock_selfies_purge_idx" ON "time"."clock_selfies" USING btree ("taken_at") WHERE "time"."clock_selfies"."purged_at" is null;--> statement-breakpoint
CREATE INDEX "idle_prompts_employee_idx" ON "time"."idle_prompts" USING btree ("employee_id","prompted_at");