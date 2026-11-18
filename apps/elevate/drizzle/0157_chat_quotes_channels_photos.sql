ALTER TABLE "chat"."conversations" DROP CONSTRAINT "conversations_kind_chk";--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD COLUMN "photo_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD COLUMN "quoted_message_id" uuid;--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_quoted_message_id_messages_id_fk" FOREIGN KEY ("quoted_message_id") REFERENCES "chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_kind_chk" CHECK ("chat"."conversations"."kind" in ('dm','group','team','department','company','client','channel'));
--> statement-breakpoint
-- A quote reply's target never changes once set (messages stay insert-only).
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
     OR NEW.quoted_message_id IS DISTINCT FROM OLD.quoted_message_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'chat.messages rows are insert-only: only deleted_at and edited_at may be set';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'chat.messages.deleted_at is already set';
  END IF;
  RETURN NEW;
END $$;
