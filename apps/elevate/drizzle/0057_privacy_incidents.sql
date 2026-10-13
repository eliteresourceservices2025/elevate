CREATE TABLE "ops"."privacy_incident_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_incident_messages_kind_chk" CHECK ("ops"."privacy_incident_messages"."author_kind" in ('reporter','handler'))
);
--> statement-breakpoint
ALTER TABLE "ops"."privacy_incident_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."privacy_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"happened_on" date NOT NULL,
	"ongoing" boolean DEFAULT false NOT NULL,
	"how_found" text NOT NULL,
	"what_happened" text NOT NULL,
	"client_id" uuid,
	"who_else_knows" text,
	"actions_taken" text,
	"status" text DEFAULT 'new' NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	CONSTRAINT "privacy_incidents_status_chk" CHECK ("ops"."privacy_incidents"."status" in ('new','in_review','closed')),
	CONSTRAINT "privacy_incidents_kind_chk" CHECK ("ops"."privacy_incidents"."kind" in ('wrong_recipient','lost_device','suspicious_link','exposed_password','unauthorized_access','left_visible','other')),
	CONSTRAINT "privacy_incidents_closed_chk" CHECK (("ops"."privacy_incidents"."status" = 'closed') = ("ops"."privacy_incidents"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "ops"."privacy_incidents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."users" ADD COLUMN "is_privacy_officer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."privacy_incident_messages" ADD CONSTRAINT "privacy_incident_messages_incident_id_privacy_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "ops"."privacy_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."privacy_incident_messages" ADD CONSTRAINT "privacy_incident_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."privacy_incidents" ADD CONSTRAINT "privacy_incidents_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."privacy_incidents" ADD CONSTRAINT "privacy_incidents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."privacy_incidents" ADD CONSTRAINT "privacy_incidents_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_incident_messages_idx" ON "ops"."privacy_incident_messages" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "privacy_incidents_status_idx" ON "ops"."privacy_incidents" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "privacy_incidents_reporter_idx" ON "ops"."privacy_incidents" USING btree ("reporter_user_id","created_at");--> statement-breakpoint
-- The report itself is evidence: its text, kind, date and reporter never change after filing. Only the handling fields move
-- (status, resolution, close fields, updated_at). Nothing is deleted, even by the owner. The thread is append-only.
CREATE OR REPLACE FUNCTION ops.privacy_incidents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'privacy incident reports cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.reporter_user_id IS DISTINCT FROM OLD.reporter_user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.happened_on IS DISTINCT FROM OLD.happened_on
     OR NEW.ongoing IS DISTINCT FROM OLD.ongoing
     OR NEW.how_found IS DISTINCT FROM OLD.how_found
     OR NEW.what_happened IS DISTINCT FROM OLD.what_happened
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.who_else_knows IS DISTINCT FROM OLD.who_else_knows
     OR NEW.actions_taken IS DISTINCT FROM OLD.actions_taken
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a privacy incident report cannot be rewritten';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER privacy_incidents_guard BEFORE UPDATE OR DELETE ON ops.privacy_incidents FOR EACH ROW EXECUTE FUNCTION ops.privacy_incidents_guard();--> statement-breakpoint
CREATE TRIGGER privacy_incidents_no_truncate BEFORE TRUNCATE ON ops.privacy_incidents FOR EACH STATEMENT EXECUTE FUNCTION talent.reject_change();--> statement-breakpoint
CREATE TRIGGER privacy_incident_messages_append_only BEFORE UPDATE OR DELETE ON ops.privacy_incident_messages FOR EACH ROW EXECUTE FUNCTION talent.reject_change();--> statement-breakpoint
CREATE TRIGGER privacy_incident_messages_no_truncate BEFORE TRUNCATE ON ops.privacy_incident_messages FOR EACH STATEMENT EXECUTE FUNCTION talent.reject_change();
