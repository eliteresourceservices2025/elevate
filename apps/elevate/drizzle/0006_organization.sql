CREATE TABLE "core"."departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."reporting_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"manager_id" uuid,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporting_lines_dates_chk" CHECK ("core"."reporting_lines"."effective_to" is null or "core"."reporting_lines"."effective_to" >= "core"."reporting_lines"."effective_from"),
	CONSTRAINT "reporting_lines_not_self_chk" CHECK ("core"."reporting_lines"."manager_id" is null or "core"."reporting_lines"."manager_id" <> "core"."reporting_lines"."employee_id")
);
--> statement-breakpoint
ALTER TABLE "core"."reporting_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"team_id" uuid,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_dates_chk" CHECK ("core"."team_memberships"."effective_to" is null or "core"."team_memberships"."effective_to" >= "core"."team_memberships"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "core"."team_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN "position_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD CONSTRAINT "positions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."reporting_lines" ADD CONSTRAINT "reporting_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."reporting_lines" ADD CONSTRAINT "reporting_lines_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."team_memberships" ADD CONSTRAINT "team_memberships_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "core"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."teams" ADD CONSTRAINT "teams_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_idx" ON "core"."departments" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "positions_title_idx" ON "core"."positions" USING btree (lower("title"));--> statement-breakpoint
CREATE INDEX "reporting_lines_employee_idx" ON "core"."reporting_lines" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "reporting_lines_manager_idx" ON "core"."reporting_lines" USING btree ("manager_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_lines_open_idx" ON "core"."reporting_lines" USING btree ("employee_id") WHERE "core"."reporting_lines"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "team_memberships_employee_idx" ON "core"."team_memberships" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "team_memberships_team_idx" ON "core"."team_memberships" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_open_idx" ON "core"."team_memberships" USING btree ("employee_id") WHERE "core"."team_memberships"."effective_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_idx" ON "core"."teams" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "teams_department_idx" ON "core"."teams" USING btree ("department_id");--> statement-breakpoint
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "core"."employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employees_team_idx" ON "core"."employees" USING btree ("team_id");