CREATE TABLE "time"."activity_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"category" text NOT NULL,
	"rank" integer DEFAULT 10 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "activity_categories_category_check" CHECK ("time"."activity_categories"."category" in ('work', 'non_work'))
);
--> statement-breakpoint
ALTER TABLE "time"."activity_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."activity_minutes" (
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"active_minutes" integer DEFAULT 0 NOT NULL,
	"idle_minutes" integer DEFAULT 0 NOT NULL,
	"work_minutes" integer DEFAULT 0 NOT NULL,
	"non_work_minutes" integer DEFAULT 0 NOT NULL,
	"top_apps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_minutes_employee_id_date_pk" PRIMARY KEY("employee_id","date")
);
--> statement-breakpoint
ALTER TABLE "time"."activity_minutes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."activity_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"app" text NOT NULL,
	"state" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_segments_range_check" CHECK ("time"."activity_segments"."ended_at" > "time"."activity_segments"."started_at"),
	CONSTRAINT "activity_segments_state_check" CHECK ("time"."activity_segments"."state" in ('active', 'idle'))
);
--> statement-breakpoint
ALTER TABLE "time"."activity_segments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."activity_settings" (
	"scope" text PRIMARY KEY NOT NULL,
	"idle_timeout_seconds" integer DEFAULT 180 NOT NULL,
	"offline_grace_minutes" integer DEFAULT 5 NOT NULL,
	"low_activity_percent" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."activity_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."activity_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"window_index" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "time"."activity_shots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."tracker_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"os" text NOT NULL,
	"app_version" text DEFAULT '0.0.0' NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions_ok" boolean DEFAULT true NOT NULL,
	"queue_size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "tracker_devices_status_check" CHECK ("time"."tracker_devices"."status" in ('active', 'revoked')),
	CONSTRAINT "tracker_devices_os_check" CHECK ("time"."tracker_devices"."os" in ('windows', 'macos'))
);
--> statement-breakpoint
ALTER TABLE "time"."tracker_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."tracker_enrollment_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."tracker_enrollment_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."activity_categories" ADD CONSTRAINT "activity_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."activity_minutes" ADD CONSTRAINT "activity_minutes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."activity_segments" ADD CONSTRAINT "activity_segments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."activity_segments" ADD CONSTRAINT "activity_segments_device_id_tracker_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "time"."tracker_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."activity_shots" ADD CONSTRAINT "activity_shots_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."activity_shots" ADD CONSTRAINT "activity_shots_device_id_tracker_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "time"."tracker_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."tracker_devices" ADD CONSTRAINT "tracker_devices_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."tracker_devices" ADD CONSTRAINT "tracker_devices_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."tracker_enrollment_codes" ADD CONSTRAINT "tracker_enrollment_codes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_segments_employee_idx" ON "time"."activity_segments" USING btree ("employee_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_shots_window_idx" ON "time"."activity_shots" USING btree ("employee_id","window_index");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_shots_path_idx" ON "time"."activity_shots" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "activity_shots_purge_idx" ON "time"."activity_shots" USING btree ("taken_at") WHERE "time"."activity_shots"."purged_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_devices_token_idx" ON "time"."tracker_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tracker_devices_employee_idx" ON "time"."tracker_devices" USING btree ("employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_codes_hash_idx" ON "time"."tracker_enrollment_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "tracker_codes_employee_idx" ON "time"."tracker_enrollment_codes" USING btree ("employee_id");--> statement-breakpoint
-- Activity segments are evidence of what happened: nobody can edit or remove one, even as the owner role.
CREATE OR REPLACE FUNCTION time.reject_activity_segment_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'time.activity_segments is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activity_segments_no_update_delete
  BEFORE UPDATE OR DELETE ON time.activity_segments
  FOR EACH ROW EXECUTE FUNCTION time.reject_activity_segment_change();
--> statement-breakpoint
CREATE TRIGGER activity_segments_no_truncate
  BEFORE TRUNCATE ON time.activity_segments
  FOR EACH STATEMENT EXECUTE FUNCTION time.reject_activity_segment_change();
--> statement-breakpoint
-- A device's token hash is set once; a new token means a new device row.
CREATE OR REPLACE FUNCTION time.keep_tracker_token_hash() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN
    RAISE EXCEPTION 'the tracker token hash cannot change';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tracker_devices_keep_token_hash
  BEFORE UPDATE ON time.tracker_devices
  FOR EACH ROW EXECUTE FUNCTION time.keep_tracker_token_hash();
--> statement-breakpoint
INSERT INTO time.activity_settings (scope) VALUES ('default') ON CONFLICT DO NOTHING;
