-- A signed signature never changes. The one thing that may still change on a signed row is how an OUTSIDE signer gets back to their
-- signed copy: a new link, a new emailed code and a new session (all stored as hashes) and the time of the last notice.
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
    IF (NEW.envelope_id, NEW.user_id, NEW.external_email, NEW.external_name, NEW.position, NEW.role, NEW.status, NEW.viewed_at,
        NEW.consent_version, NEW.signature_kind, NEW.signed_name, NEW.signature_text, NEW.signature_png, NEW.signed_at, NEW.ip,
        NEW.mfa_methods, NEW.decline_reason)
       IS DISTINCT FROM
       (OLD.envelope_id, OLD.user_id, OLD.external_email, OLD.external_name, OLD.position, OLD.role, OLD.status, OLD.viewed_at,
        OLD.consent_version, OLD.signature_kind, OLD.signed_name, OLD.signature_text, OLD.signature_png, OLD.signed_at, OLD.ip,
        OLD.mfa_methods, OLD.decline_reason) THEN
      RAISE EXCEPTION 'a signature cannot change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
