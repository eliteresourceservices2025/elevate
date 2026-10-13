CREATE TABLE "core"."attendance_leads" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"lead_employee_id" uuid NOT NULL,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_leads_not_self_chk" CHECK ("core"."attendance_leads"."lead_employee_id" <> "core"."attendance_leads"."employee_id")
);
--> statement-breakpoint
ALTER TABLE "core"."attendance_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."attendance_leads" ADD CONSTRAINT "attendance_leads_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."attendance_leads" ADD CONSTRAINT "attendance_leads_lead_employee_id_employees_id_fk" FOREIGN KEY ("lead_employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_leads_lead_idx" ON "core"."attendance_leads" USING btree ("lead_employee_id");