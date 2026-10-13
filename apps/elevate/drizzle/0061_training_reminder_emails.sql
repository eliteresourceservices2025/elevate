ALTER TABLE "ops"."email_queue" DROP CONSTRAINT "email_queue_kind_chk";--> statement-breakpoint
ALTER TABLE "ops"."email_preferences" ADD COLUMN "training_reminder_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."email_queue" ADD CONSTRAINT "email_queue_kind_chk" CHECK ("ops"."email_queue"."kind" in ('ack_due','digest','invite','reminder'));