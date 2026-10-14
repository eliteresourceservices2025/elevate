ALTER TABLE "ops"."schedule_import_batches" DROP CONSTRAINT "schedule_import_batches_status_chk";--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_batches" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_batches" ADD COLUMN "applied_by" uuid;--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_batches" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_batches" ADD CONSTRAINT "schedule_import_batches_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_batches" ADD CONSTRAINT "schedule_import_batches_status_chk" CHECK ("ops"."schedule_import_batches"."status" in ('preview','discarded','applied'));