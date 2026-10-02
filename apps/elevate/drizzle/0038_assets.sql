CREATE TABLE "talent"."asset_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"condition_out" text NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assign_note" text,
	"returned_at" timestamp with time zone,
	"condition_in" text,
	"received_by" uuid,
	"return_note" text,
	CONSTRAINT "asset_assignments_cond_out_chk" CHECK ("talent"."asset_assignments"."condition_out" in ('new','good','fair','damaged')),
	CONSTRAINT "asset_assignments_cond_in_chk" CHECK ("talent"."asset_assignments"."condition_in" is null or "talent"."asset_assignments"."condition_in" in ('new','good','fair','damaged')),
	CONSTRAINT "asset_assignments_return_chk" CHECK (("talent"."asset_assignments"."returned_at" is null) = ("talent"."asset_assignments"."condition_in" is null) and ("talent"."asset_assignments"."returned_at" is null) = ("talent"."asset_assignments"."received_by" is null))
);
--> statement-breakpoint
ALTER TABLE "talent"."asset_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"serial_number" text,
	"notes" text,
	"purchase_date" date,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_status_chk" CHECK ("talent"."assets"."status" in ('in_stock','assigned','repair','lost','retired')),
	CONSTRAINT "assets_category_chk" CHECK ("talent"."assets"."category" in ('laptop','desktop','monitor','headset','phone','peripheral','network','other'))
);
--> statement-breakpoint
ALTER TABLE "talent"."assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."checklist_template_items" DROP CONSTRAINT "checklist_template_items_check_chk";--> statement-breakpoint
ALTER TABLE "talent"."asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "talent"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."asset_assignments" ADD CONSTRAINT "asset_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."asset_assignments" ADD CONSTRAINT "asset_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."asset_assignments" ADD CONSTRAINT "asset_assignments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_assignments_active_idx" ON "talent"."asset_assignments" USING btree ("asset_id") WHERE "talent"."asset_assignments"."returned_at" is null;--> statement-breakpoint
CREATE INDEX "asset_assignments_asset_idx" ON "talent"."asset_assignments" USING btree ("asset_id","assigned_at");--> statement-breakpoint
CREATE INDEX "asset_assignments_employee_idx" ON "talent"."asset_assignments" USING btree ("employee_id","returned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_tag_idx" ON "talent"."assets" USING btree (upper("tag"));--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "talent"."assets" USING btree ("status","category");--> statement-breakpoint
ALTER TABLE "talent"."checklist_template_items" ADD CONSTRAINT "checklist_template_items_check_chk" CHECK ("talent"."checklist_template_items"."check_kind" in ('manual','document','required_documents','policy','account','signature','exit_interview','access','assets_returned'));
--> statement-breakpoint
-- The hand-over history is append-only: a row is written once at assignment and closed once by its return (returned_at, condition_in,
-- received_by, return_note). After that nothing changes it and nothing deletes it. Everything else in the row is frozen from the start.
CREATE OR REPLACE FUNCTION talent.guard_asset_assignment() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.returned_at IS NOT NULL THEN
      RAISE EXCEPTION 'asset_assignments are append-only: a returned assignment cannot change';
    END IF;
    IF NEW.returned_at IS NULL
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
       OR NEW.condition_out IS DISTINCT FROM OLD.condition_out
       OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
       OR NEW.assign_note IS DISTINCT FROM OLD.assign_note THEN
      RAISE EXCEPTION 'asset_assignments are append-only: only the return can be recorded';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'asset_assignments are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_assignments_append_only BEFORE UPDATE OR DELETE ON talent.asset_assignments FOR EACH ROW EXECUTE FUNCTION talent.guard_asset_assignment();
--> statement-breakpoint
CREATE TRIGGER asset_assignments_no_truncate BEFORE TRUNCATE ON talent.asset_assignments FOR EACH STATEMENT EXECUTE FUNCTION talent.guard_asset_assignment();
--> statement-breakpoint
-- Offboarding templates and still-open offboarding checklists get ELEVATE's own check for "Equipment and assets returned" instead of a hand tick.
UPDATE talent.checklist_template_items SET check_kind = 'assets_returned', href = coalesce(href, '/assets') WHERE check_kind = 'manual' AND title = 'Equipment and assets returned' AND template_id IN (SELECT id FROM talent.checklist_templates WHERE kind = 'offboarding');
--> statement-breakpoint
UPDATE talent.checklist_tasks SET check_kind = 'assets_returned', href = coalesce(href, '/assets') WHERE check_kind = 'manual' AND status = 'todo' AND title = 'Equipment and assets returned' AND offboarding_case_id IN (SELECT id FROM talent.offboarding_cases WHERE status = 'open');