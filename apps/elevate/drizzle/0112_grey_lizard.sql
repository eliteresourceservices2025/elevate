ALTER TABLE "time"."jibble_mismatches" DROP CONSTRAINT "jibble_mismatch_kind_chk";--> statement-breakpoint
ALTER TABLE "time"."jibble_mismatches" ADD COLUMN "jibble_entry_id" text;--> statement-breakpoint
ALTER TABLE "time"."jibble_mismatches" ADD COLUMN "jibble_entry_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time"."jibble_mismatches" ADD CONSTRAINT "jibble_mismatch_kind_chk" CHECK ("time"."jibble_mismatches"."kind" in ('working_jibble_out','working_jibble_break','possible_jibble_only','elevate_out_jibble_in'));