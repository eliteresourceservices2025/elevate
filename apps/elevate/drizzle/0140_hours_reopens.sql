CREATE TABLE "time"."hours_reopens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reopened_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"reopened_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."hours_reopens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."hours_reopens" ADD CONSTRAINT "hours_reopens_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hours_reopens_employee_idx" ON "time"."hours_reopens" USING btree ("employee_id","date","reopened_at");--> statement-breakpoint
-- A reopen is a record of who took an approval back and why: nobody can edit or remove one, even with direct database access.
-- A mistake is fixed by approving the day again (a newer approval row), like hours approvals.
CREATE OR REPLACE FUNCTION time.reject_hours_reopen_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'time.hours_reopens is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hours_reopens_no_update_delete
  BEFORE UPDATE OR DELETE ON time.hours_reopens
  FOR EACH ROW EXECUTE FUNCTION time.reject_hours_reopen_change();
--> statement-breakpoint
CREATE TRIGGER hours_reopens_no_truncate
  BEFORE TRUNCATE ON time.hours_reopens
  FOR EACH STATEMENT EXECUTE FUNCTION time.reject_hours_reopen_change();
