CREATE TABLE "chat"."message_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"uploader_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bucket" text NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"sha256" text,
	"duration_s" integer,
	"name_enc" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attachments_kind_chk" CHECK ("chat"."message_attachments"."kind" in ('image','file','voice')),
	CONSTRAINT "message_attachments_status_chk" CHECK ("chat"."message_attachments"."status" in ('pending','active','rejected'))
);
--> statement-breakpoint
ALTER TABLE "chat"."message_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat"."message_attachments" ADD CONSTRAINT "message_attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message_attachments" ADD CONSTRAINT "message_attachments_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_attachments_path_idx" ON "chat"."message_attachments" USING btree ("bucket","path");--> statement-breakpoint
CREATE INDEX "message_attachments_message_idx" ON "chat"."message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_attachments_uploader_idx" ON "chat"."message_attachments" USING btree ("uploader_user_id","status","created_at");