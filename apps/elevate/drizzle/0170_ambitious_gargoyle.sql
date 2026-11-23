CREATE TABLE "core"."client_project_members" (
	"project_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_project_members_project_id_employee_id_pk" PRIMARY KEY("project_id","employee_id")
);
--> statement-breakpoint
ALTER TABLE "core"."client_project_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."client_project_members" ADD CONSTRAINT "client_project_members_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "core"."client_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."client_project_members" ADD CONSTRAINT "client_project_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_project_members_employee_idx" ON "core"."client_project_members" USING btree ("employee_id");