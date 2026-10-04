CREATE TABLE "ops"."import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'talenthr_csv' NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"date_format" text DEFAULT 'mdy' NOT NULL,
	"mapping" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_by" uuid,
	"committed_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	CONSTRAINT "import_batches_status_chk" CHECK ("ops"."import_batches"."status" in ('preview','committed','rolled_back','discarded')),
	CONSTRAINT "import_batches_date_format_chk" CHECK ("ops"."import_batches"."date_format" in ('mdy','dmy','iso'))
);
--> statement-breakpoint
ALTER TABLE "ops"."import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"outcome" text NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload_enc" text,
	"employee_id" uuid,
	"created" text DEFAULT 'no' NOT NULL,
	"state" text DEFAULT 'staged' NOT NULL,
	CONSTRAINT "import_rows_outcome_chk" CHECK ("ops"."import_rows"."outcome" in ('new','changed','unchanged','error')),
	CONSTRAINT "import_rows_created_chk" CHECK ("ops"."import_rows"."created" in ('yes','no')),
	CONSTRAINT "import_rows_state_chk" CHECK ("ops"."import_rows"."state" in ('staged','committed','skipped','rolled_back','kept'))
);
--> statement-breakpoint
ALTER TABLE "ops"."import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."import_batches" ADD CONSTRAINT "import_batches_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."import_batches" ADD CONSTRAINT "import_batches_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "ops"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."import_rows" ADD CONSTRAINT "import_rows_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_created_idx" ON "ops"."import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_batch_row_idx" ON "ops"."import_rows" USING btree ("batch_id","row_no");--> statement-breakpoint
CREATE INDEX "import_rows_employee_idx" ON "ops"."import_rows" USING btree ("employee_id");