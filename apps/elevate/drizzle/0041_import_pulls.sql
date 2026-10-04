CREATE TABLE "ops"."import_pull_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"employee_id" uuid,
	"outcome" text NOT NULL,
	"reason" text,
	"sha256" text,
	"payload_enc" text,
	CONSTRAINT "import_pull_items_kind_chk" CHECK ("ops"."import_pull_items"."kind" in ('document','leave_history','applicants')),
	CONSTRAINT "import_pull_items_outcome_chk" CHECK ("ops"."import_pull_items"."outcome" in ('imported','archived','duplicate','skipped','failed'))
);
--> statement-breakpoint
ALTER TABLE "ops"."import_pull_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."import_pulls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"dry_run" text DEFAULT 'no' NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "import_pulls_status_chk" CHECK ("ops"."import_pulls"."status" in ('running','done','failed')),
	CONSTRAINT "import_pulls_dry_chk" CHECK ("ops"."import_pulls"."dry_run" in ('yes','no'))
);
--> statement-breakpoint
ALTER TABLE "ops"."import_pulls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."import_pull_items" ADD CONSTRAINT "import_pull_items_pull_id_import_pulls_id_fk" FOREIGN KEY ("pull_id") REFERENCES "ops"."import_pulls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."import_pull_items" ADD CONSTRAINT "import_pull_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."import_pulls" ADD CONSTRAINT "import_pulls_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_pull_items_pull_idx" ON "ops"."import_pull_items" USING btree ("pull_id");--> statement-breakpoint
CREATE INDEX "import_pull_items_employee_idx" ON "ops"."import_pull_items" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_pull_items_done_idx" ON "ops"."import_pull_items" USING btree ("kind","source_id") WHERE "ops"."import_pull_items"."outcome" in ('imported','archived');