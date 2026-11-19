CREATE TABLE "chat"."call_recording_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_recording_parts_status_chk" CHECK ("chat"."call_recording_parts"."status" in ('pending','ready'))
);
--> statement-breakpoint
ALTER TABLE "chat"."call_recording_parts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."call_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"recorder_user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."call_recordings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."recording_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recording_consents_answer_chk" CHECK ("chat"."recording_consents"."answer" in ('allow','decline'))
);
--> statement-breakpoint
ALTER TABLE "chat"."recording_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat"."call_recording_parts" ADD CONSTRAINT "call_recording_parts_recording_id_call_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "chat"."call_recordings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."call_recordings" ADD CONSTRAINT "call_recordings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "chat"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."call_recordings" ADD CONSTRAINT "call_recordings_recorder_user_id_users_id_fk" FOREIGN KEY ("recorder_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."recording_consents" ADD CONSTRAINT "recording_consents_recording_id_call_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "chat"."call_recordings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."recording_consents" ADD CONSTRAINT "recording_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_recording_parts_seq_idx" ON "chat"."call_recording_parts" USING btree ("recording_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "call_recordings_one_live_idx" ON "chat"."call_recordings" USING btree ("call_id") WHERE "chat"."call_recordings"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "call_recordings_expiry_idx" ON "chat"."call_recordings" USING btree ("expires_at") WHERE "chat"."call_recordings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "call_recordings_recorder_idx" ON "chat"."call_recordings" USING btree ("recorder_user_id");--> statement-breakpoint
CREATE INDEX "recording_consents_idx" ON "chat"."recording_consents" USING btree ("recording_id","user_id","answered_at");--> statement-breakpoint
-- Consent answers are history: never edited or removed (a changed mind is a new row; the latest one counts).
CREATE FUNCTION chat.recording_consents_insert_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'recording_consents is insert-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recording_consents_no_change BEFORE UPDATE OR DELETE ON chat.recording_consents FOR EACH ROW EXECUTE FUNCTION chat.recording_consents_insert_only();
