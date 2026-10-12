CREATE TABLE "time"."hours_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"test_only" boolean NOT NULL,
	"note" text NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."hours_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."hours_marks" ADD CONSTRAINT "hours_marks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hours_marks_employee_idx" ON "time"."hours_marks" USING btree ("employee_id","date","set_at");--> statement-breakpoint
-- A mark is a record of who decided a day was a test: nobody can edit or remove one, even with direct database access.
-- A mistake is fixed by a newer row (the mark taken off), like hours approvals.
CREATE OR REPLACE FUNCTION time.reject_hours_mark_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'time.hours_marks is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER hours_marks_no_update_delete
  BEFORE UPDATE OR DELETE ON time.hours_marks
  FOR EACH ROW EXECUTE FUNCTION time.reject_hours_mark_change();
--> statement-breakpoint
CREATE TRIGGER hours_marks_no_truncate
  BEFORE TRUNCATE ON time.hours_marks
  FOR EACH STATEMENT EXECUTE FUNCTION time.reject_hours_mark_change();
