CREATE TABLE "talent"."certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."checklist_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"onboarding_case_id" uuid,
	"offboarding_case_id" uuid,
	"employee_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"owner" text NOT NULL,
	"owner_user_id" uuid,
	"due_on" date NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"check_kind" text DEFAULT 'manual' NOT NULL,
	"document_type_id" uuid,
	"policy_id" uuid,
	"policy_kind" text,
	"sign_template_id" uuid,
	"envelope_id" uuid,
	"href" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"auto_completed" boolean DEFAULT false NOT NULL,
	"note" text,
	"last_reminder_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_tasks_one_case_chk" CHECK (("talent"."checklist_tasks"."onboarding_case_id" is null) <> ("talent"."checklist_tasks"."offboarding_case_id" is null)),
	CONSTRAINT "checklist_tasks_status_chk" CHECK ("talent"."checklist_tasks"."status" in ('todo','done','skipped')),
	CONSTRAINT "checklist_tasks_owner_chk" CHECK ("talent"."checklist_tasks"."owner" in ('hr','lead','person'))
);
--> statement-breakpoint
ALTER TABLE "talent"."checklist_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."checklist_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"owner" text NOT NULL,
	"due_offset_days" smallint DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"check_kind" text DEFAULT 'manual' NOT NULL,
	"document_type_id" uuid,
	"policy_id" uuid,
	"policy_kind" text,
	"sign_template_id" uuid,
	"href" text,
	CONSTRAINT "checklist_template_items_owner_chk" CHECK ("talent"."checklist_template_items"."owner" in ('hr','lead','person')),
	CONSTRAINT "checklist_template_items_check_chk" CHECK ("talent"."checklist_template_items"."check_kind" in ('manual','document','required_documents','policy','account','signature','exit_interview','access'))
);
--> statement-breakpoint
ALTER TABLE "talent"."checklist_template_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"position_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_templates_kind_chk" CHECK ("talent"."checklist_templates"."kind" in ('onboarding','offboarding'))
);
--> statement-breakpoint
ALTER TABLE "talent"."checklist_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."exit_interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offboarding_case_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"reason_for_leaving" text NOT NULL,
	"went_well" text,
	"to_improve" text,
	"would_return" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exit_interviews_return_chk" CHECK ("talent"."exit_interviews"."would_return" in ('yes','maybe','no'))
);
--> statement-breakpoint
ALTER TABLE "talent"."exit_interviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."offboarding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"last_working_day" date NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"template_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"access_removed_at" timestamp with time zone,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offboarding_cases_status_chk" CHECK ("talent"."offboarding_cases"."status" in ('open','completed','cancelled')),
	CONSTRAINT "offboarding_cases_reason_chk" CHECK ("talent"."offboarding_cases"."reason" in ('resignation','end_of_contract','termination','other'))
);
--> statement-breakpoint
ALTER TABLE "talent"."offboarding_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ADD COLUMN "completed_by" uuid;--> statement-breakpoint
ALTER TABLE "talent"."certificates" ADD CONSTRAINT "certificates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."certificates" ADD CONSTRAINT "certificates_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."checklist_tasks" ADD CONSTRAINT "checklist_tasks_onboarding_case_id_onboarding_cases_id_fk" FOREIGN KEY ("onboarding_case_id") REFERENCES "talent"."onboarding_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."checklist_tasks" ADD CONSTRAINT "checklist_tasks_offboarding_case_id_offboarding_cases_id_fk" FOREIGN KEY ("offboarding_case_id") REFERENCES "talent"."offboarding_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."checklist_tasks" ADD CONSTRAINT "checklist_tasks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."checklist_tasks" ADD CONSTRAINT "checklist_tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."checklist_tasks" ADD CONSTRAINT "checklist_tasks_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "docs"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."checklist_tasks" ADD CONSTRAINT "checklist_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."checklist_template_items" ADD CONSTRAINT "checklist_template_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "talent"."checklist_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."checklist_template_items" ADD CONSTRAINT "checklist_template_items_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "docs"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."checklist_templates" ADD CONSTRAINT "checklist_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."exit_interviews" ADD CONSTRAINT "exit_interviews_offboarding_case_id_offboarding_cases_id_fk" FOREIGN KEY ("offboarding_case_id") REFERENCES "talent"."offboarding_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."exit_interviews" ADD CONSTRAINT "exit_interviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."offboarding_cases" ADD CONSTRAINT "offboarding_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."offboarding_cases" ADD CONSTRAINT "offboarding_cases_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "talent"."checklist_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."offboarding_cases" ADD CONSTRAINT "offboarding_cases_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."offboarding_cases" ADD CONSTRAINT "offboarding_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_reference_idx" ON "talent"."certificates" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "checklist_tasks_onboarding_idx" ON "talent"."checklist_tasks" USING btree ("onboarding_case_id","position");--> statement-breakpoint
CREATE INDEX "checklist_tasks_offboarding_idx" ON "talent"."checklist_tasks" USING btree ("offboarding_case_id","position");--> statement-breakpoint
CREATE INDEX "checklist_tasks_owner_idx" ON "talent"."checklist_tasks" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "checklist_template_items_template_idx" ON "talent"."checklist_template_items" USING btree ("template_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_templates_position_idx" ON "talent"."checklist_templates" USING btree ("kind","position_id") WHERE "talent"."checklist_templates"."archived_at" is null and "talent"."checklist_templates"."position_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_templates_default_idx" ON "talent"."checklist_templates" USING btree ("kind") WHERE "talent"."checklist_templates"."archived_at" is null and "talent"."checklist_templates"."position_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "exit_interviews_case_idx" ON "talent"."exit_interviews" USING btree ("offboarding_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offboarding_cases_open_idx" ON "talent"."offboarding_cases" USING btree ("employee_id") WHERE "talent"."offboarding_cases"."status" = 'open';--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ADD CONSTRAINT "onboarding_cases_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "talent"."checklist_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ADD CONSTRAINT "onboarding_cases_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;