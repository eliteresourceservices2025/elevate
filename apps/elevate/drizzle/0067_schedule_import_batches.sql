CREATE TABLE "ops"."schedule_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"layout" text NOT NULL,
	"columns" jsonb,
	"source_sha256" text NOT NULL,
	"observation_count" integer NOT NULL,
	"pair_count" integer NOT NULL,
	"payload_enc" text,
	"status" text DEFAULT 'preview' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discarded_at" timestamp with time zone,
	CONSTRAINT "schedule_import_batches_status_chk" CHECK ("ops"."schedule_import_batches"."status" in ('preview','discarded')),
	CONSTRAINT "schedule_import_batches_layout_chk" CHECK ("ops"."schedule_import_batches"."layout" in ('day_blocks','table'))
);
--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_batches" ADD CONSTRAINT "schedule_import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_import_batches_created_idx" ON "ops"."schedule_import_batches" USING btree ("created_at");--> statement-breakpoint