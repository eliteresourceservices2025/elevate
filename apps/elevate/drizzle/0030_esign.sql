CREATE TABLE "docs"."esign_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"template_id" uuid,
	"created_by" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"signing_order" text DEFAULT 'sequential' NOT NULL,
	"original_path" text NOT NULL,
	"original_name" text NOT NULL,
	"original_sha256" text NOT NULL,
	"page_count" smallint NOT NULL,
	"sealed_path" text,
	"sealed_sha256" text,
	"sealed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"all_signed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "esign_envelopes_status_chk" CHECK ("docs"."esign_envelopes"."status" in ('draft','out','completed','declined','voided','expired')),
	CONSTRAINT "esign_envelopes_order_chk" CHECK ("docs"."esign_envelopes"."signing_order" in ('sequential','parallel')),
	CONSTRAINT "esign_envelopes_sealed_chk" CHECK (("docs"."esign_envelopes"."sealed_path" is null) = ("docs"."esign_envelopes"."sealed_sha256" is null) and ("docs"."esign_envelopes"."sealed_path" is null) = ("docs"."esign_envelopes"."sealed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "docs"."esign_envelopes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."esign_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" uuid,
	"signer_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"detail" jsonb,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs"."esign_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."esign_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"role" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"last_notice_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"consent_version" text,
	"signature_kind" text,
	"signed_name" text,
	"signature_text" text,
	"signature_png" text,
	"signed_at" timestamp with time zone,
	"ip" text,
	"mfa_methods" text,
	"decline_reason" text,
	CONSTRAINT "esign_signers_status_chk" CHECK ("docs"."esign_signers"."status" in ('waiting','pending','signed','declined','cancelled')),
	CONSTRAINT "esign_signers_kind_chk" CHECK ("docs"."esign_signers"."signature_kind" is null or "docs"."esign_signers"."signature_kind" in ('typed','drawn')),
	CONSTRAINT "esign_signers_signed_chk" CHECK (("docs"."esign_signers"."status" <> 'signed') or ("docs"."esign_signers"."signed_at" is not null and "docs"."esign_signers"."signature_kind" is not null and "docs"."esign_signers"."consent_version" is not null and "docs"."esign_signers"."signed_name" is not null))
);
--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."esign_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_path" text NOT NULL,
	"sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"page_count" smallint NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs"."esign_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "docs"."esign_envelopes" ADD CONSTRAINT "esign_envelopes_template_id_esign_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "docs"."esign_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."esign_envelopes" ADD CONSTRAINT "esign_envelopes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."esign_events" ADD CONSTRAINT "esign_events_envelope_id_esign_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "docs"."esign_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."esign_events" ADD CONSTRAINT "esign_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."esign_events" ADD CONSTRAINT "esign_events_signer_id_esign_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "docs"."esign_signers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD CONSTRAINT "esign_signers_envelope_id_esign_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "docs"."esign_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD CONSTRAINT "esign_signers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."esign_templates" ADD CONSTRAINT "esign_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "esign_envelopes_status_idx" ON "docs"."esign_envelopes" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "esign_envelopes_sealed_sha_idx" ON "docs"."esign_envelopes" USING btree ("sealed_sha256") WHERE "docs"."esign_envelopes"."sealed_sha256" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "esign_events_envelope_seq_idx" ON "docs"."esign_events" USING btree ("envelope_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "esign_signers_envelope_user_idx" ON "docs"."esign_signers" USING btree ("envelope_id","user_id");--> statement-breakpoint
CREATE INDEX "esign_signers_user_idx" ON "docs"."esign_signers" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "esign_templates_name_idx" ON "docs"."esign_templates" USING btree (lower("name")) WHERE "docs"."esign_templates"."archived_at" is null;
--> statement-breakpoint
-- ELEVATE Sign evidence is immutable, even with direct database access.
-- The event log: append-only (and no truncate).
CREATE OR REPLACE FUNCTION docs.esign_reject_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER esign_events_append_only BEFORE UPDATE OR DELETE ON docs.esign_events FOR EACH ROW EXECUTE FUNCTION docs.esign_reject_change();
--> statement-breakpoint
CREATE TRIGGER esign_events_no_truncate BEFORE TRUNCATE ON docs.esign_events FOR EACH STATEMENT EXECUTE FUNCTION docs.esign_reject_change();
--> statement-breakpoint
-- An envelope: the original is fixed once it is sent, the sealed copy is set once, a finished envelope never changes status, and only
-- a draft can be deleted.
CREATE OR REPLACE FUNCTION docs.esign_envelope_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'only a draft envelope can be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.original_sha256 <> OLD.original_sha256 OR NEW.original_path <> OLD.original_path) THEN
    RAISE EXCEPTION 'the original document of a sent envelope cannot change';
  END IF;
  IF OLD.sealed_sha256 IS NOT NULL AND (NEW.sealed_sha256 IS DISTINCT FROM OLD.sealed_sha256 OR NEW.sealed_path IS DISTINCT FROM OLD.sealed_path) THEN
    RAISE EXCEPTION 'a sealed copy cannot change';
  END IF;
  IF OLD.status IN ('completed','declined','voided','expired') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'a finished envelope cannot change status';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER esign_envelopes_guard BEFORE UPDATE OR DELETE ON docs.esign_envelopes FOR EACH ROW EXECUTE FUNCTION docs.esign_envelope_guard();
--> statement-breakpoint
-- A signer: once signed, nothing about the row changes; deleting is only for a draft envelope.
CREATE OR REPLACE FUNCTION docs.esign_signer_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM docs.esign_envelopes e WHERE e.id = OLD.envelope_id AND e.status <> 'draft') THEN
      RAISE EXCEPTION 'signers of a sent envelope cannot be removed';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'a signature cannot change';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER esign_signers_guard BEFORE UPDATE OR DELETE ON docs.esign_signers FOR EACH ROW EXECUTE FUNCTION docs.esign_signer_guard();
