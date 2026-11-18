CREATE TABLE "chat"."call_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'attendee' NOT NULL,
	"cf_session_id" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "call_participants_role_chk" CHECK ("chat"."call_participants"."role" in ('host','speaker','attendee'))
);
--> statement-breakpoint
ALTER TABLE "chat"."call_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."call_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"recording_enabled" boolean DEFAULT false NOT NULL,
	"townhall_enabled" boolean DEFAULT true NOT NULL,
	"monthly_gb_warning" integer DEFAULT 700 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_settings_single_chk" CHECK ("chat"."call_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "chat"."call_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."call_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cf_session_id" text NOT NULL,
	"track_name" text NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "call_tracks_kind_chk" CHECK ("chat"."call_tracks"."kind" in ('audio','video','screen'))
);
--> statement-breakpoint
ALTER TABLE "chat"."call_tracks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."call_usage" (
	"call_id" uuid PRIMARY KEY NOT NULL,
	"estimated_gb" numeric(8, 2) NOT NULL,
	"participant_minutes" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."call_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"mode" text DEFAULT 'meeting' NOT NULL,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"max_participants" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "calls_mode_chk" CHECK ("chat"."calls"."mode" in ('meeting','townhall'))
);
--> statement-breakpoint
ALTER TABLE "chat"."calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."users" ADD COLUMN "can_record_calls" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."call_participants" ADD CONSTRAINT "call_participants_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "chat"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."call_participants" ADD CONSTRAINT "call_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."call_tracks" ADD CONSTRAINT "call_tracks_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "chat"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."call_tracks" ADD CONSTRAINT "call_tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."call_usage" ADD CONSTRAINT "call_usage_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "chat"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."calls" ADD CONSTRAINT "calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."calls" ADD CONSTRAINT "calls_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_participants_open_idx" ON "chat"."call_participants" USING btree ("call_id","user_id") WHERE "chat"."call_participants"."left_at" is null;--> statement-breakpoint
CREATE INDEX "call_participants_user_idx" ON "chat"."call_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_tracks_session_name_idx" ON "chat"."call_tracks" USING btree ("call_id","cf_session_id","track_name");--> statement-breakpoint
CREATE INDEX "call_tracks_call_idx" ON "chat"."call_tracks" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_one_live_per_conversation_idx" ON "chat"."calls" USING btree ("conversation_id") WHERE "chat"."calls"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "calls_conversation_idx" ON "chat"."calls" USING btree ("conversation_id","started_at");
--> statement-breakpoint
-- The one settings row (recording stays OFF until a Super Admin switches it on).
INSERT INTO chat.call_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- A guest can never be picked to record calls.
ALTER TABLE core.users DROP CONSTRAINT users_guest_flags_chk;
--> statement-breakpoint
ALTER TABLE core.users ADD CONSTRAINT users_guest_flags_chk
  CHECK (NOT is_guest OR (payroll_access IS NULL AND NOT is_privacy_officer AND NOT is_safevoice_handler AND NOT can_record_calls));
--> statement-breakpoint
-- Who may subscribe to a private Realtime channel: user:<own id>; conv:<id> and call:<id> for current members of that conversation
-- (a call channel only while the call is live).
CREATE OR REPLACE FUNCTION chat.can_join(topic text, uid uuid) RETURNS boolean
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
      WHEN topic ~ '^call:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN EXISTS (
          SELECT 1
          FROM chat.calls ca
          JOIN chat.conversations c ON c.id = ca.conversation_id
          JOIN chat.conversation_members m ON m.conversation_id = ca.conversation_id
          WHERE ca.id = substr(topic, 6)::uuid
            AND ca.ended_at IS NULL
            AND m.user_id = uid
            AND m.left_at IS NULL
            AND c.archived_at IS NULL)
      ELSE false
    END, false)
$$;
--> statement-breakpoint
-- On a call channel a browser may only TRACK PRESENCE (who is here, muted, hand raised): every real signal (tracks changed, ringing,
-- removed) is sent by the server, so another participant can't forge one. The Supabase roles and Realtime schema exist on Supabase
-- projects but not on a plain Postgres (CI), so this step is conditional.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages') THEN
    EXECUTE 'DROP POLICY IF EXISTS chat_send ON realtime.messages';
    EXECUTE 'CREATE POLICY chat_send ON realtime.messages FOR INSERT TO authenticated WITH CHECK (chat.can_join(realtime.topic(), (SELECT auth.uid())) AND (realtime.topic() NOT LIKE ''call:%'' OR extension = ''presence''))';
  END IF;
END $$;
