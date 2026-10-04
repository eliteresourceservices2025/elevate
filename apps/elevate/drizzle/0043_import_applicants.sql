ALTER TABLE "ops"."import_pull_items" DROP CONSTRAINT "import_pull_items_kind_chk";--> statement-breakpoint
ALTER TABLE "ops"."import_pull_items" ADD COLUMN "local_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."import_pull_items" ADD CONSTRAINT "import_pull_items_kind_chk" CHECK ("ops"."import_pull_items"."kind" in ('document','leave_history','applicants','opening','application'));