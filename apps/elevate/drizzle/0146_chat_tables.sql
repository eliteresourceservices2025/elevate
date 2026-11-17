CREATE SCHEMA "chat";
--> statement-breakpoint
CREATE TABLE "chat"."conversation_members" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"muted_until" timestamp with time zone,
	CONSTRAINT "conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "conversation_members_role_chk" CHECK ("chat"."conversation_members"."role" in ('owner','member'))
);
--> statement-breakpoint
ALTER TABLE "chat"."conversation_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"dm_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "conversations_kind_chk" CHECK ("chat"."conversations"."kind" in ('dm','group')),
	CONSTRAINT "conversations_dm_key_chk" CHECK (("chat"."conversations"."kind" = 'dm') = ("chat"."conversations"."dm_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "chat"."conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."message_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"body_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."message_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "chat"."messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"body_enc" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "messages_kind_chk" CHECK ("chat"."messages"."kind" in ('text','system'))
);
--> statement-breakpoint
ALTER TABLE "chat"."messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat"."conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message_revisions" ADD CONSTRAINT "message_revisions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_members_user_idx" ON "chat"."conversation_members" USING btree ("user_id","left_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_dm_key_idx" ON "chat"."conversations" USING btree ("dm_key") WHERE "chat"."conversations"."dm_key" is not null;--> statement-breakpoint
CREATE INDEX "message_revisions_message_idx" ON "chat"."message_revisions" USING btree ("message_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_seq_idx" ON "chat"."messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "messages_sender_created_idx" ON "chat"."messages" USING btree ("sender_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_seq_idx" ON "chat"."messages" USING btree ("seq");