-- Previewing a DRAFT in Learn, for the people who edit courses. A draft is invisible to the Learn app role otherwise (it reads
-- published versions and the versions of its own assignments). The function names who counts as an editor: HR Admin, Super Admin or
-- the designated Privacy Officer. Drafts hold lesson text only; the answer key is in learn.questions, which stays without a grant.
CREATE FUNCTION learn.is_content_editor(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = learn, core, pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM core.user_roles ur WHERE ur.user_id = p_user AND ur.role_slug IN ('super_admin', 'hr_admin'))
      OR EXISTS (SELECT 1 FROM core.users u WHERE u.id = p_user AND u.is_privacy_officer AND u.archived_at IS NULL)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION learn.is_content_editor(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION learn.is_content_editor(uuid) TO learn_app;--> statement-breakpoint
CREATE POLICY learn_app_preview ON learn.course_versions FOR SELECT TO learn_app USING (status = 'draft' AND learn.is_content_editor(learn.current_user_id()));
