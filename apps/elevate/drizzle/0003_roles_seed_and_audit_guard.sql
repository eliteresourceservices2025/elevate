-- Reference data: the six roles. Keep in sync with ROLE_SLUGS in src/lib/roles.ts.
INSERT INTO core.roles (slug, name, description) VALUES
  ('super_admin', 'Super Admin', 'Full access, including roles and the audit log.'),
  ('hr_admin', 'HR Admin', 'Manages people, time off, documents, policies and templates.'),
  ('team_lead', 'Team Lead', 'Manages their own team: first-level approvals, attendance and reviews.'),
  ('recruiter', 'Recruiter', 'Works the hiring pipeline only.'),
  ('executive', 'Executive', 'Read-only summaries and analytics.'),
  ('employee', 'Employee / VA', 'Own record, own time off, own tasks. Everyone holds this role.')
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint

-- The audit log is insert-only. Privileges alone are not enough because the owner role can
-- re-grant itself, so triggers refuse every change and truncate. The retention job (Phase 0.x)
-- must use a dedicated SECURITY DEFINER function that disables these triggers deliberately.
CREATE OR REPLACE FUNCTION ops.audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'ops.audit_log is insert-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON ops.audit_log
  FOR EACH ROW EXECUTE FUNCTION ops.audit_log_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON ops.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION ops.audit_log_reject_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON ops.audit_log FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ops.audit_log FROM anon, authenticated;
  END IF;
END
$$;
