ALTER TABLE "ops"."email_preferences" ALTER COLUMN "digest_opt_out" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "ops"."email_preferences" ALTER COLUMN "training_reminder_opt_out" SET DEFAULT true;--> statement-breakpoint
-- Email choices are opt-in now: everyone starts unticked and chooses for themselves.
UPDATE "ops"."email_preferences" SET "digest_opt_out" = true, "training_reminder_opt_out" = true;
