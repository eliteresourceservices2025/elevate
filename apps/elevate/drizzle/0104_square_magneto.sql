ALTER TABLE "time"."jibble_operation_guard" ADD COLUMN "kind" text DEFAULT 'send' NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."jibble_operation_guard" ADD COLUMN "action" text;--> statement-breakpoint
ALTER TABLE "time"."jibble_operation_guard" ADD COLUMN "log_id" uuid;--> statement-breakpoint
ALTER TABLE "time"."jibble_operation_guard" ADD COLUMN "jibble_person_id" text;--> statement-breakpoint
ALTER TABLE "time"."jibble_operation_guard" ADD CONSTRAINT "jibble_operation_guard_kind_chk" CHECK ("time"."jibble_operation_guard"."kind" in ('send','repair','reconcile'));--> statement-breakpoint
ALTER TABLE "time"."jibble_operation_guard" ADD CONSTRAINT "jibble_operation_guard_action_chk" CHECK ("time"."jibble_operation_guard"."action" is null or "time"."jibble_operation_guard"."action" in ('In','Out','StartBreak','EndBreak'));