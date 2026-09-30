-- Invite-only sign-up. Supabase Auth calls this before it creates any user, for every
-- provider (email/password and Google). No matching, unexpired, unaccepted invitation = no account.
-- Configured in supabase/config.toml: [auth.hook.before_user_created].
CREATE SCHEMA IF NOT EXISTS private;
--> statement-breakpoint
REVOKE ALL ON SCHEMA private FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(event -> 'user' ->> 'email');
BEGIN
  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1
    FROM core.invitations i
    WHERE lower(i.email) = v_email
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
  ) THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'error',
    jsonb_build_object(
      'message', 'Sign-up is by invitation only.',
      'http_code', 403
    )
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.before_user_created(jsonb) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT USAGE ON SCHEMA private TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION private.before_user_created(jsonb) TO supabase_auth_admin;
  END IF;
END
$$;
