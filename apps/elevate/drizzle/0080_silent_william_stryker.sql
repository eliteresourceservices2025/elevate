ALTER TABLE "docs"."esign_envelopes" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "docs"."esign_envelopes" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "docs"."esign_envelopes" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "docs"."esign_envelopes" ADD CONSTRAINT "esign_envelopes_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Evidence stays immutable, with ONE exception: a document marked as a test can be deleted (envelope, signers and log together, in one
-- transaction, by the app for a Super Admin). A real document can never be deleted: only a draft, or one marked as a test.
CREATE OR REPLACE FUNCTION docs.esign_envelope_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' AND NOT OLD.is_test THEN RAISE EXCEPTION 'only a draft or a test envelope can be deleted'; END IF;
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
-- The log is append-only: no update, ever. Delete is refused unless the whole envelope is a test.
CREATE OR REPLACE FUNCTION docs.esign_events_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM docs.esign_envelopes e WHERE e.id = OLD.envelope_id AND e.is_test) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS esign_events_append_only ON docs.esign_events;--> statement-breakpoint
CREATE TRIGGER esign_events_append_only BEFORE UPDATE OR DELETE ON docs.esign_events FOR EACH ROW EXECUTE FUNCTION docs.esign_events_guard();--> statement-breakpoint
-- A signed signer row never changes (now including initials and the details typed while signing, which the earlier guard missed);
-- deleting is only for a draft envelope or a test envelope.
CREATE OR REPLACE FUNCTION docs.esign_signer_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM docs.esign_envelopes e WHERE e.id = OLD.envelope_id AND e.status <> 'draft' AND NOT e.is_test) THEN
      RAISE EXCEPTION 'signers of a sent envelope cannot be removed';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'signed' THEN
    IF (NEW.envelope_id, NEW.user_id, NEW.external_email, NEW.external_name, NEW.position, NEW.role, NEW.status, NEW.viewed_at,
        NEW.consent_version, NEW.signature_kind, NEW.signed_name, NEW.signature_text, NEW.signature_png, NEW.signed_at, NEW.ip,
        NEW.mfa_methods, NEW.decline_reason, NEW.initials_text, NEW.initialed_pages, NEW.fills_details, NEW.details_enc)
       IS DISTINCT FROM
       (OLD.envelope_id, OLD.user_id, OLD.external_email, OLD.external_name, OLD.position, OLD.role, OLD.status, OLD.viewed_at,
        OLD.consent_version, OLD.signature_kind, OLD.signed_name, OLD.signature_text, OLD.signature_png, OLD.signed_at, OLD.ip,
        OLD.mfa_methods, OLD.decline_reason, OLD.initials_text, OLD.initialed_pages, OLD.fills_details, OLD.details_enc) THEN
      RAISE EXCEPTION 'a signature cannot change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
