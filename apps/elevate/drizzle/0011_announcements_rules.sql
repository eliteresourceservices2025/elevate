-- Acknowledgments are evidence: nobody can edit or remove one, even with direct database access
-- as the owner role (same approach as ops.audit_log).
CREATE OR REPLACE FUNCTION docs.reject_acknowledgment_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'docs.acknowledgments is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER acknowledgments_no_update_delete
  BEFORE UPDATE OR DELETE ON docs.acknowledgments
  FOR EACH ROW EXECUTE FUNCTION docs.reject_acknowledgment_change();
--> statement-breakpoint
CREATE TRIGGER acknowledgments_no_truncate
  BEFORE TRUNCATE ON docs.acknowledgments
  FOR EACH STATEMENT EXECUTE FUNCTION docs.reject_acknowledgment_change();
--> statement-breakpoint
-- A published policy version is frozen: the text people acknowledged must stay the text they acknowledged.
-- A change is a new version. Drafts can be edited and discarded freely.
CREATE OR REPLACE FUNCTION docs.freeze_published_policy_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'A published policy version cannot be changed or deleted; publish a new version instead';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policy_versions_freeze
  BEFORE UPDATE OR DELETE ON docs.policy_versions
  FOR EACH ROW EXECUTE FUNCTION docs.freeze_published_policy_version();
--> statement-breakpoint
-- Two policies the rest of the app depends on. Each starts as a DRAFT placeholder: nobody sees it and nobody
-- can acknowledge it until HR replaces the text (with counsel) and publishes it.
INSERT INTO docs.policies (slug, title, kind) VALUES
  ('privacy_notice', 'Privacy notice', 'privacy_notice'),
  ('monitoring_policy', 'Work monitoring policy', 'monitoring')
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
INSERT INTO docs.policy_versions (policy_id, version, body, status, requires_ack)
SELECT p.id, 1, v.body, 'draft', true
FROM docs.policies p
JOIN (VALUES
  ('privacy_notice', E'# DRAFT PLACEHOLDER: replace before go-live\n\nThis text is a placeholder and must be replaced with the privacy notice approved by ERS and its counsel. It covers how ELEVATE collects, uses, stores and shares personal data, who the Data Protection Officer is, how long records are kept and how people can exercise their rights under the Data Privacy Act of 2012.'),
  ('monitoring_policy', E'# DRAFT PLACEHOLDER: replace before go-live\n\nThis text is a placeholder and must be replaced with the work monitoring policy approved by ERS and its counsel. It describes what is monitored while a person is clocked in (time tracking and periodic screenshots through Jibble), why, who can see it, how long it is kept, and how to ask questions. The Jibble mirror stays off until this policy is published and acknowledged.')
) AS v(slug, body) ON v.slug = p.slug
ON CONFLICT (policy_id, version) DO NOTHING;
