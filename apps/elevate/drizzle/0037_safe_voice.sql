CREATE TABLE "ops"."safevoice_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"message_id" uuid,
	"position" smallint NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "safevoice_attachments_type_chk" CHECK ("ops"."safevoice_attachments"."content_type" in ('image/jpeg','image/png','application/pdf'))
);
--> statement-breakpoint
ALTER TABLE "ops"."safevoice_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."safevoice_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "ops"."safevoice_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"author" text NOT NULL,
	"body" text NOT NULL,
	"sent_day" date DEFAULT (now() at time zone 'utc')::date NOT NULL,
	"handler_notified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "safevoice_messages_author_chk" CHECK ("ops"."safevoice_messages"."author" in ('reporter','handler')),
	CONSTRAINT "safevoice_messages_body_chk" CHECK (char_length("ops"."safevoice_messages"."body") between 1 and 8000)
);
--> statement-breakpoint
ALTER TABLE "ops"."safevoice_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."safevoice_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"pass_salt" "bytea" NOT NULL,
	"pass_hash" "bytea" NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"outcome" text,
	"created_day" date DEFAULT (now() at time zone 'utc')::date NOT NULL,
	"closed_day" date,
	"handler_notified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "safevoice_reports_category_chk" CHECK ("ops"."safevoice_reports"."category" in ('harassment','discrimination','retaliation','safety','fraud_or_ethics','management_conduct','client_conduct','other')),
	CONSTRAINT "safevoice_reports_status_chk" CHECK ("ops"."safevoice_reports"."status" in ('new','in_review','awaiting_reporter','closed')),
	CONSTRAINT "safevoice_reports_outcome_chk" CHECK ("ops"."safevoice_reports"."outcome" is null or "ops"."safevoice_reports"."outcome" in ('substantiated','partly_substantiated','not_substantiated','no_action','referred','unable_to_determine')),
	CONSTRAINT "safevoice_reports_closed_chk" CHECK (("ops"."safevoice_reports"."status" = 'closed') = ("ops"."safevoice_reports"."outcome" is not null)),
	CONSTRAINT "safevoice_reports_description_chk" CHECK (char_length("ops"."safevoice_reports"."description") between 1 and 8000)
);
--> statement-breakpoint
ALTER TABLE "ops"."safevoice_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."safevoice_attachments" ADD CONSTRAINT "safevoice_attachments_report_id_safevoice_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "ops"."safevoice_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."safevoice_attachments" ADD CONSTRAINT "safevoice_attachments_message_id_safevoice_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "ops"."safevoice_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."safevoice_messages" ADD CONSTRAINT "safevoice_messages_report_id_safevoice_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "ops"."safevoice_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safevoice_attachments_report_idx" ON "ops"."safevoice_attachments" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "safevoice_messages_report_idx" ON "ops"."safevoice_messages" USING btree ("report_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "safevoice_reports_code_hash_idx" ON "ops"."safevoice_reports" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "safevoice_reports_status_idx" ON "ops"."safevoice_reports" USING btree ("status","created_day");--> statement-breakpoint
-- Safe Voice database roles. NOLOGIN here on purpose: operations gives each a password out of band
-- (ALTER ROLE safevoice_app LOGIN PASSWORD '...'), so no secret is ever in this repository. See docs/SETUP.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safevoice_app') THEN
    CREATE ROLE safevoice_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safevoice_handler') THEN
    CREATE ROLE safevoice_handler NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA ops TO safevoice_app, safevoice_handler;--> statement-breakpoint
-- The reporter-facing app: may add reports, messages and attachments, and read back only what a reporter is shown plus the
-- credential columns it must compare. It cannot update or delete anything, and it cannot read attachment bytes.
GRANT INSERT ON ops.safevoice_reports, ops.safevoice_messages, ops.safevoice_attachments TO safevoice_app;--> statement-breakpoint
GRANT SELECT (id, code_hash, pass_salt, pass_hash, status, outcome, created_day, closed_day) ON ops.safevoice_reports TO safevoice_app;--> statement-breakpoint
GRANT SELECT (id, report_id, seq, author, body, sent_day) ON ops.safevoice_messages TO safevoice_app;--> statement-breakpoint
GRANT SELECT (id, report_id, message_id, position, content_type, size_bytes) ON ops.safevoice_attachments TO safevoice_app;--> statement-breakpoint
-- ELEVATE's handlers: read cases (never the code or passphrase hashes), answer, change status, close, and mark notified.
GRANT SELECT (id, category, description, status, outcome, created_day, closed_day, handler_notified) ON ops.safevoice_reports TO safevoice_handler;--> statement-breakpoint
GRANT SELECT ON ops.safevoice_messages, ops.safevoice_attachments TO safevoice_handler;--> statement-breakpoint
GRANT INSERT ON ops.safevoice_messages TO safevoice_handler;--> statement-breakpoint
GRANT UPDATE (status, outcome, closed_day, handler_notified) ON ops.safevoice_reports TO safevoice_handler;--> statement-breakpoint
GRANT UPDATE (handler_notified) ON ops.safevoice_messages TO safevoice_handler;--> statement-breakpoint
-- Row-level security is on with NO public policy: only these two named roles have any (the app's own role bypasses nothing).
CREATE POLICY safevoice_app_select ON ops.safevoice_reports FOR SELECT TO safevoice_app USING (true);--> statement-breakpoint
CREATE POLICY safevoice_app_insert ON ops.safevoice_reports FOR INSERT TO safevoice_app WITH CHECK (status = 'new' AND outcome IS NULL AND closed_day IS NULL AND NOT handler_notified);--> statement-breakpoint
CREATE POLICY safevoice_app_select ON ops.safevoice_messages FOR SELECT TO safevoice_app USING (true);--> statement-breakpoint
CREATE POLICY safevoice_app_insert ON ops.safevoice_messages FOR INSERT TO safevoice_app WITH CHECK (author = 'reporter' AND NOT handler_notified);--> statement-breakpoint
CREATE POLICY safevoice_app_select ON ops.safevoice_attachments FOR SELECT TO safevoice_app USING (true);--> statement-breakpoint
CREATE POLICY safevoice_app_insert ON ops.safevoice_attachments FOR INSERT TO safevoice_app WITH CHECK (true);--> statement-breakpoint
CREATE POLICY safevoice_handler_select ON ops.safevoice_reports FOR SELECT TO safevoice_handler USING (true);--> statement-breakpoint
CREATE POLICY safevoice_handler_update ON ops.safevoice_reports FOR UPDATE TO safevoice_handler USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY safevoice_handler_select ON ops.safevoice_messages FOR SELECT TO safevoice_handler USING (true);--> statement-breakpoint
CREATE POLICY safevoice_handler_insert ON ops.safevoice_messages FOR INSERT TO safevoice_handler WITH CHECK (author = 'handler');--> statement-breakpoint
CREATE POLICY safevoice_handler_update ON ops.safevoice_messages FOR UPDATE TO safevoice_handler USING (author = 'reporter') WITH CHECK (author = 'reporter');--> statement-breakpoint
CREATE POLICY safevoice_handler_select ON ops.safevoice_attachments FOR SELECT TO safevoice_handler USING (true);--> statement-breakpoint
-- Reports and messages are never rewritten or deleted: a trigger allows only the status, outcome and "notified" columns to move.
CREATE FUNCTION ops.safevoice_reports_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Safe Voice reports cannot be deleted';
  END IF;
  IF (NEW.id, NEW.code_hash, NEW.pass_salt, NEW.pass_hash, NEW.category, NEW.description, NEW.created_day)
     IS DISTINCT FROM (OLD.id, OLD.code_hash, OLD.pass_salt, OLD.pass_hash, OLD.category, OLD.description, OLD.created_day) THEN
    RAISE EXCEPTION 'Safe Voice reports cannot be rewritten';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER safevoice_reports_guard BEFORE UPDATE OR DELETE ON ops.safevoice_reports FOR EACH ROW EXECUTE FUNCTION ops.safevoice_reports_guard();--> statement-breakpoint
CREATE FUNCTION ops.safevoice_messages_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Safe Voice messages cannot be deleted';
  END IF;
  IF (NEW.id, NEW.report_id, NEW.seq, NEW.author, NEW.body, NEW.sent_day)
     IS DISTINCT FROM (OLD.id, OLD.report_id, OLD.seq, OLD.author, OLD.body, OLD.sent_day) THEN
    RAISE EXCEPTION 'Safe Voice messages cannot be rewritten';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER safevoice_messages_guard BEFORE UPDATE OR DELETE ON ops.safevoice_messages FOR EACH ROW EXECUTE FUNCTION ops.safevoice_messages_guard();
