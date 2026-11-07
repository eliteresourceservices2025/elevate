CREATE SCHEMA "payroll";
--> statement-breakpoint
CREATE TABLE "payroll"."pay_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"run_hash_enc" text NOT NULL,
	"note_enc" text,
	"decided_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_approvals_decision_chk" CHECK ("payroll"."pay_approvals"."decision" in ('approved','sent_back'))
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll"."pay_change_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"run_id" uuid,
	"employee_id" uuid,
	"line_key" uuid,
	"detail_enc" text NOT NULL,
	"view_day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_change_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll"."pay_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"line_key" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"client_id" uuid,
	"alias" text,
	"hours_per_day" smallint NOT NULL,
	"fte" numeric(3, 2) NOT NULL,
	"ends_on" date,
	"effective_from" date NOT NULL,
	"amounts_enc" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_lines_hours_chk" CHECK ("payroll"."pay_lines"."hours_per_day" between 1 and 12)
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll"."pay_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"reference_enc" text NOT NULL,
	"paid_on" date NOT NULL,
	"marked_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll"."pay_run_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"run_line_id" uuid,
	"type" text NOT NULL,
	"state" text NOT NULL,
	"value_enc" text NOT NULL,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_run_items_state_chk" CHECK ("payroll"."pay_run_items"."state" in ('suggested','confirmed','dismissed'))
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll"."pay_run_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"client_id" uuid,
	"alias" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"payload_enc" text NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll"."pay_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"usd_rate_e4" integer,
	"settings_snapshot" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_runs_status_chk" CHECK ("payroll"."pay_runs"."status" in ('draft','in_review','approved','paid')),
	CONSTRAINT "pay_runs_period_chk" CHECK ("payroll"."pay_runs"."period_end" >= "payroll"."pay_runs"."period_start")
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll"."pay_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" date NOT NULL,
	"cutoff_divisor" smallint NOT NULL,
	"extra_regular_bp" integer,
	"extra_holiday_bp" integer,
	"extra_rest_day_bp" integer,
	"extra_rest_day_over_8_bp" integer,
	"holiday_bp" integer,
	"change_warn_bp" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll"."pay_approvals" ADD CONSTRAINT "pay_approvals_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_approvals" ADD CONSTRAINT "pay_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_change_log" ADD CONSTRAINT "pay_change_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_change_log" ADD CONSTRAINT "pay_change_log_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_change_log" ADD CONSTRAINT "pay_change_log_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_lines" ADD CONSTRAINT "pay_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_lines" ADD CONSTRAINT "pay_lines_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_lines" ADD CONSTRAINT "pay_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_payments" ADD CONSTRAINT "pay_payments_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_payments" ADD CONSTRAINT "pay_payments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_payments" ADD CONSTRAINT "pay_payments_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_items" ADD CONSTRAINT "pay_run_items_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_items" ADD CONSTRAINT "pay_run_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_items" ADD CONSTRAINT "pay_run_items_run_line_id_pay_run_lines_id_fk" FOREIGN KEY ("run_line_id") REFERENCES "payroll"."pay_run_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_items" ADD CONSTRAINT "pay_run_items_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_lines" ADD CONSTRAINT "pay_run_lines_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_lines" ADD CONSTRAINT "pay_run_lines_line_id_pay_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "payroll"."pay_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_lines" ADD CONSTRAINT "pay_run_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_lines" ADD CONSTRAINT "pay_run_lines_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_lines" ADD CONSTRAINT "pay_run_lines_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ADD CONSTRAINT "pay_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ADD CONSTRAINT "pay_runs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_runs" ADD CONSTRAINT "pay_runs_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_settings" ADD CONSTRAINT "pay_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_approvals_run_idx" ON "payroll"."pay_approvals" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_change_log_view_idx" ON "payroll"."pay_change_log" USING btree ("actor_id","run_id","view_day") WHERE "payroll"."pay_change_log"."view_day" is not null;--> statement-breakpoint
CREATE INDEX "pay_change_log_run_idx" ON "payroll"."pay_change_log" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "pay_lines_employee_idx" ON "payroll"."pay_lines" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "pay_lines_key_idx" ON "payroll"."pay_lines" USING btree ("line_key","effective_from");--> statement-breakpoint
CREATE INDEX "pay_payments_run_idx" ON "payroll"."pay_payments" USING btree ("run_id","employee_id","created_at");--> statement-breakpoint
CREATE INDEX "pay_run_items_run_idx" ON "payroll"."pay_run_items" USING btree ("run_id","employee_id","created_at");--> statement-breakpoint
CREATE INDEX "pay_run_lines_run_idx" ON "payroll"."pay_run_lines" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_run_lines_run_line_idx" ON "payroll"."pay_run_lines" USING btree ("run_id","line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_runs_period_idx" ON "payroll"."pay_runs" USING btree ("period_start","period_end");