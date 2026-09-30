CREATE SEQUENCE "core"."employee_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "core"."change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"category" text NOT NULL,
	"payload" jsonb,
	"payload_enc" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_requests_category_chk" CHECK ("core"."change_requests"."category" in ('contact','emergency_contacts','bank')),
	CONSTRAINT "change_requests_status_chk" CHECK ("core"."change_requests"."status" in ('pending','approved','rejected','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "core"."change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."client_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"hours_per_week" numeric(4, 1),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_assignments_dates_chk" CHECK ("core"."client_assignments"."end_date" is null or "core"."client_assignments"."end_date" >= "core"."client_assignments"."start_date"),
	CONSTRAINT "client_assignments_hours_chk" CHECK ("core"."client_assignments"."hours_per_week" is null or ("core"."client_assignments"."hours_per_week" > 0 and "core"."client_assignments"."hours_per_week" <= 80))
);
--> statement-breakpoint
ALTER TABLE "core"."client_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"time_zone" text DEFAULT 'America/New_York' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."custom_field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" jsonb,
	"visibility" text DEFAULT 'hr_only' NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_defs_type_chk" CHECK ("core"."custom_field_defs"."field_type" in ('text','number','date','select')),
	CONSTRAINT "custom_field_defs_visibility_chk" CHECK ("core"."custom_field_defs"."visibility" in ('hr_only','employee_visible'))
);
--> statement-breakpoint
ALTER TABLE "core"."custom_field_defs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."custom_field_values" (
	"employee_id" uuid NOT NULL,
	"field_def_id" uuid NOT NULL,
	"value" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_values_employee_id_field_def_id_pk" PRIMARY KEY("employee_id","field_def_id")
);
--> statement-breakpoint
ALTER TABLE "core"."custom_field_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."emergency_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."emergency_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."employee_sensitive" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"tin_enc" text,
	"sss_enc" text,
	"philhealth_enc" text,
	"pagibig_enc" text,
	"bank_name_enc" text,
	"bank_account_name_enc" text,
	"bank_account_number_enc" text,
	"pay_rate_enc" text,
	"pay_currency" text DEFAULT 'PHP' NOT NULL,
	"masks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."employee_sensitive" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_number" text DEFAULT 'ERS-' || lpad(nextval('core.employee_number_seq')::text, 4, '0') NOT NULL,
	"user_id" uuid,
	"legal_first_name" text NOT NULL,
	"legal_middle_name" text,
	"legal_last_name" text NOT NULL,
	"preferred_name" text,
	"birth_date" date,
	"civil_status" text,
	"work_email" text NOT NULL,
	"personal_email" text,
	"mobile" text,
	"address_line" text,
	"city" text,
	"province" text,
	"postal_code" text,
	"country" text DEFAULT 'PH' NOT NULL,
	"position" text,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"worker_type" text DEFAULT 'contractor' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_status_chk" CHECK ("core"."employees"."status" in ('onboarding','active','probation','on_leave','separated')),
	CONSTRAINT "employees_worker_type_chk" CHECK ("core"."employees"."worker_type" in ('contractor','employee')),
	CONSTRAINT "employees_civil_status_chk" CHECK ("core"."employees"."civil_status" is null or "core"."employees"."civil_status" in ('single','married','widowed','separated','other'))
);
--> statement-breakpoint
ALTER TABLE "core"."employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."employment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"effective_date" date DEFAULT current_date NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."employment_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."change_requests" ADD CONSTRAINT "change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."client_assignments" ADD CONSTRAINT "client_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."client_assignments" ADD CONSTRAINT "client_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."custom_field_values" ADD CONSTRAINT "custom_field_values_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."custom_field_values" ADD CONSTRAINT "custom_field_values_field_def_id_custom_field_defs_id_fk" FOREIGN KEY ("field_def_id") REFERENCES "core"."custom_field_defs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."emergency_contacts" ADD CONSTRAINT "emergency_contacts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."employee_sensitive" ADD CONSTRAINT "employee_sensitive_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."employment_history" ADD CONSTRAINT "employment_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_requests_status_idx" ON "core"."change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "change_requests_pending_idx" ON "core"."change_requests" USING btree ("employee_id","category") WHERE "core"."change_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "client_assignments_employee_idx" ON "core"."client_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "client_assignments_client_idx" ON "core"."client_assignments" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_assignments_open_idx" ON "core"."client_assignments" USING btree ("employee_id","client_id") WHERE "core"."client_assignments"."end_date" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_name_idx" ON "core"."clients" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_defs_key_idx" ON "core"."custom_field_defs" USING btree ("key");--> statement-breakpoint
CREATE INDEX "emergency_contacts_employee_idx" ON "core"."emergency_contacts" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_number_idx" ON "core"."employees" USING btree ("employee_number");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_work_email_idx" ON "core"."employees" USING btree (lower("work_email"));--> statement-breakpoint
CREATE UNIQUE INDEX "employees_user_idx" ON "core"."employees" USING btree ("user_id") WHERE "core"."employees"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "core"."employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employment_history_employee_idx" ON "core"."employment_history" USING btree ("employee_id","created_at");