CREATE TABLE "payroll"."jibble_matches" (
	"member_code" text PRIMARY KEY NOT NULL,
	"line_key" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jibble_matches_code_chk" CHECK (char_length("payroll"."jibble_matches"."member_code") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "payroll"."jibble_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll"."timesheet_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"payload_enc" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll"."timesheet_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll"."jibble_matches" ADD CONSTRAINT "jibble_matches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."timesheet_imports" ADD CONSTRAINT "timesheet_imports_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."timesheet_imports" ADD CONSTRAINT "timesheet_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timesheet_imports_run_idx" ON "payroll"."timesheet_imports" USING btree ("run_id");