DROP INDEX "time"."jibble_mismatch_open_idx";--> statement-breakpoint
ALTER TABLE "time"."jibble_mismatches" ADD COLUMN "family" text DEFAULT 'working' NOT NULL;--> statement-breakpoint
UPDATE "time"."jibble_mismatches" SET "family" = 'out' WHERE "kind" IN ('possible_jibble_only', 'elevate_out_jibble_in');--> statement-breakpoint
CREATE UNIQUE INDEX "jibble_mismatch_open_idx" ON "time"."jibble_mismatches" USING btree ("employee_id","family") WHERE "time"."jibble_mismatches"."resolved_at" is null;--> statement-breakpoint
ALTER TABLE "time"."jibble_mismatches" ADD CONSTRAINT "jibble_mismatch_family_chk" CHECK (("time"."jibble_mismatches"."family" = 'working' and "time"."jibble_mismatches"."kind" in ('working_jibble_out','working_jibble_break')) or ("time"."jibble_mismatches"."family" = 'out' and "time"."jibble_mismatches"."kind" in ('possible_jibble_only','elevate_out_jibble_in')));
