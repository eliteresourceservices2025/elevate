-- Chat guards: messages are insert-only (apart from one deleted_at stamp and edited_at), revisions never change,
-- and chat.can_join says who may subscribe to which Realtime channel. See docs/modules/messages.md.

CREATE FUNCTION chat.messages_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'chat.messages rows are insert-only: only deleted_at and edited_at may be set';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'chat.messages.deleted_at is already set';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER messages_guard BEFORE UPDATE OR DELETE ON chat.messages
  FOR EACH ROW EXECUTE FUNCTION chat.messages_guard();
--> statement-breakpoint
CREATE FUNCTION chat.revisions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'chat.message_revisions rows are append-only';
END $$;
--> statement-breakpoint
CREATE TRIGGER revisions_guard BEFORE UPDATE OR DELETE ON chat.message_revisions
  FOR EACH ROW EXECUTE FUNCTION chat.revisions_guard();
--> statement-breakpoint
-- Who may subscribe to a private Realtime channel: "user:<own id>" and "conv:<id>" while a current member of that conversation.
CREATE FUNCTION chat.can_join(topic text, uid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = chat, pg_temp AS $$
  SELECT coalesce(
    CASE
      WHEN topic ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN substr(topic, 6)::uuid = uid
      WHEN topic ~ '^conv:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN EXISTS (
          SELECT 1
          FROM chat.conversation_members m
          JOIN chat.conversations c ON c.id = m.conversation_id
          WHERE c.id = substr(topic, 6)::uuid
            AND m.user_id = uid
            AND m.left_at IS NULL
            AND c.archived_at IS NULL)
      ELSE false
    END, false)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION chat.can_join(text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- The Supabase roles and the Realtime schema exist on Supabase projects but not on a plain Postgres (CI), so these steps are conditional.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA chat FROM PUBLIC';
    EXECUTE 'GRANT USAGE ON SCHEMA chat TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION chat.can_join(text, uuid) TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages') THEN
    EXECUTE 'DROP POLICY IF EXISTS chat_receive ON realtime.messages';
    EXECUTE 'CREATE POLICY chat_receive ON realtime.messages FOR SELECT TO authenticated USING (chat.can_join(realtime.topic(), (SELECT auth.uid())))';
    EXECUTE 'DROP POLICY IF EXISTS chat_send ON realtime.messages';
    EXECUTE 'CREATE POLICY chat_send ON realtime.messages FOR INSERT TO authenticated WITH CHECK (chat.can_join(realtime.topic(), (SELECT auth.uid())))';
  END IF;
END $$;
