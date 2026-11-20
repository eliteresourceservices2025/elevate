CREATE TABLE "chat"."message_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"pinned_by" uuid NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unpinned_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."message_pins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."message_reactions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "chat"."message_reactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat"."messages" DROP CONSTRAINT "messages_kind_chk";--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD COLUMN "thread_root_id" uuid;--> statement-breakpoint
ALTER TABLE "chat"."message_pins" ADD CONSTRAINT "message_pins_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message_pins" ADD CONSTRAINT "message_pins_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message_pins" ADD CONSTRAINT "message_pins_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_pins_open_idx" ON "chat"."message_pins" USING btree ("message_id") WHERE "chat"."message_pins"."unpinned_at" is null;--> statement-breakpoint
CREATE INDEX "message_pins_conversation_idx" ON "chat"."message_pins" USING btree ("conversation_id","pinned_at");--> statement-breakpoint
CREATE INDEX "message_reactions_message_idx" ON "chat"."message_reactions" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_thread_root_id_messages_id_fk" FOREIGN KEY ("thread_root_id") REFERENCES "chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "chat"."messages" USING btree ("thread_root_id","seq");--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_kind_chk" CHECK ("chat"."messages"."kind" in ('text','system','poll','image','file','voice','gif'));--> statement-breakpoint
-- The insert-only guard now also protects thread_root_id: a message never moves into or out of a thread.
CREATE OR REPLACE FUNCTION chat.messages_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'chat.messages rows cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.sender_user_id IS DISTINCT FROM OLD.sender_user_id
     OR NEW.body_enc IS DISTINCT FROM OLD.body_enc
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.thread_root_id IS DISTINCT FROM OLD.thread_root_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'chat.messages rows are insert-only: only deleted_at and edited_at may be set';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'chat.messages.deleted_at is already set';
  END IF;
  RETURN NEW;
END $$;
