CREATE TABLE "chat"."user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"appear_offline" boolean DEFAULT false NOT NULL,
	"email_digest" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."user_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."email_queue" DROP CONSTRAINT "email_queue_kind_chk";--> statement-breakpoint
ALTER TABLE "chat"."user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."email_queue" ADD CONSTRAINT "email_queue_kind_chk" CHECK ("ops"."email_queue"."kind" in ('ack_due','digest','invite','reminder','chat_unread'));