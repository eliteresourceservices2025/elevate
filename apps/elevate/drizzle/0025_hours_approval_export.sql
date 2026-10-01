CREATE TABLE "time"."hours_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"scheduled_minutes" integer,
	"worked_minutes" integer NOT NULL,
	"break_minutes" integer NOT NULL,
	"extra_minutes" integer NOT NULL,
	"approved_extra_minutes" integer NOT NULL,
	"approved_by" uuid NOT NULL,
	"note" text,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."hours_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."hours_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"pay_period_kind" text DEFAULT 'semi_monthly' NOT NULL,
	"biweekly_anchor" date DEFAULT '2026-01-05' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hours_settings_single_chk" CHECK ("time"."hours_settings"."id" = 1),
	CONSTRAINT "hours_settings_kind_chk" CHECK ("time"."hours_settings"."pay_period_kind" in ('semi_monthly','weekly','biweekly','monthly'))
);
--> statement-breakpoint
ALTER TABLE "time"."hours_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."hours_approvals" ADD CONSTRAINT "hours_approvals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hours_approvals_employee_idx" ON "time"."hours_approvals" USING btree ("employee_id","date","approved_at");--> statement-breakpoint
CREATE INDEX "hours_approvals_date_idx" ON "time"."hours_approvals" USING btree ("date");
--> statement-breakpoint
-- An approval is evidence of what a lead signed off: nobody can edit or remove one, even with direct database access. A mistake is
-- fixed by approving again (a new row).
CREATE OR REPLACE FUNCTION time.reject_hours_approval_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'time.hours_approvals is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hours_approvals_no_update_delete
  BEFORE UPDATE OR DELETE ON time.hours_approvals
  FOR EACH ROW EXECUTE FUNCTION time.reject_hours_approval_change();
--> statement-breakpoint
CREATE TRIGGER hours_approvals_no_truncate
  BEFORE TRUNCATE ON time.hours_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION time.reject_hours_approval_change();
--> statement-breakpoint
-- The one settings row.
INSERT INTO time.hours_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
