CREATE TABLE "core"."people_retention_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"archive_after_months" smallint DEFAULT 60 NOT NULL,
	"anonymize_after_months" smallint DEFAULT 72 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_retention_settings_one_row" CHECK ("core"."people_retention_settings"."id" = 1),
	CONSTRAINT "people_retention_settings_order_chk" CHECK ("core"."people_retention_settings"."anonymize_after_months" > "core"."people_retention_settings"."archive_after_months")
);
--> statement-breakpoint
ALTER TABLE "core"."people_retention_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN "retention_archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN "legal_hold_reason" text;--> statement-breakpoint
ALTER TABLE "core"."people_retention_settings" ADD CONSTRAINT "people_retention_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- An anonymized record cannot be changed again, except by the retention job (it sets core.retention for its transaction).
CREATE OR REPLACE FUNCTION core.employees_guard_anonymized() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.anonymized_at IS NOT NULL AND coalesce(current_setting('core.retention', true), '') <> 'on' THEN
    RAISE EXCEPTION 'this record was anonymized and cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER employees_guard_anonymized
  BEFORE UPDATE ON core.employees
  FOR EACH ROW EXECUTE FUNCTION core.employees_guard_anonymized();
