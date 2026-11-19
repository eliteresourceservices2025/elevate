CREATE TABLE "chat"."access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"recording_id" uuid,
	"requested_by" uuid NOT NULL,
	"window_from" timestamp with time zone,
	"window_to" timestamp with time zone,
	"reason_enc" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note_enc" text,
	"access_expires_at" timestamp with time zone,
	"read_count" integer DEFAULT 0 NOT NULL,
	"first_read_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"members_notified_at" timestamp with time zone,
	CONSTRAINT "access_requests_kind_chk" CHECK ("chat"."access_requests"."kind" in ('chat','recording')),
	CONSTRAINT "access_requests_status_chk" CHECK ("chat"."access_requests"."status" in ('pending','approved','denied','cancelled')),
	CONSTRAINT "access_requests_recording_chk" CHECK (("chat"."access_requests"."kind" = 'recording') = ("chat"."access_requests"."recording_id" is not null)),
	CONSTRAINT "access_requests_window_chk" CHECK ("chat"."access_requests"."kind" <> 'chat' or ("chat"."access_requests"."window_from" is not null and "chat"."access_requests"."window_to" is not null and "chat"."access_requests"."window_to" > "chat"."access_requests"."window_from" and "chat"."access_requests"."window_to" - "chat"."access_requests"."window_from" <= interval '92 days')),
	CONSTRAINT "access_requests_two_person_chk" CHECK ("chat"."access_requests"."decided_by" is null or "chat"."access_requests"."decided_by" <> "chat"."access_requests"."requested_by"),
	CONSTRAINT "access_requests_approved_chk" CHECK ("chat"."access_requests"."status" <> 'approved' or ("chat"."access_requests"."decided_by" is not null and "chat"."access_requests"."access_expires_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "chat"."access_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat"."access_requests" ADD CONSTRAINT "access_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."access_requests" ADD CONSTRAINT "access_requests_recording_id_call_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "chat"."call_recordings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."access_requests" ADD CONSTRAINT "access_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."access_requests" ADD CONSTRAINT "access_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_status_idx" ON "chat"."access_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "access_requests_requester_idx" ON "chat"."access_requests" USING btree ("requested_by","requested_at");--> statement-breakpoint
-- A request is fixed once made: only its decision (once, from pending) and the usage counters can change; nothing is ever deleted.
CREATE FUNCTION chat.access_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'access_requests rows are never deleted';
  END IF;
  IF (NEW.kind, NEW.conversation_id, NEW.recording_id, NEW.requested_by, NEW.window_from, NEW.window_to, NEW.reason_enc, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.kind, OLD.conversation_id, OLD.recording_id, OLD.requested_by, OLD.window_from, OLD.window_to, OLD.reason_enc, OLD.requested_at) THEN
    RAISE EXCEPTION 'an access request cannot be changed after it was made';
  END IF;
  IF OLD.status <> 'pending' THEN
    IF (NEW.status, NEW.decided_by, NEW.decided_at, NEW.decision_note_enc, NEW.access_expires_at)
       IS DISTINCT FROM
       (OLD.status, OLD.decided_by, OLD.decided_at, OLD.decision_note_enc, OLD.access_expires_at) THEN
      RAISE EXCEPTION 'a decided access request cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_requests_no_change BEFORE UPDATE OR DELETE ON chat.access_requests FOR EACH ROW EXECUTE FUNCTION chat.access_requests_guard();
