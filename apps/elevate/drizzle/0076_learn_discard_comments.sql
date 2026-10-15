-- A draft can be discarded together with its editor comments. The guard still refuses to delete a comment of a version that is not a
-- draft, and still never lets the text or the author change; it only stops blocking the delete that discarding a draft needs.
CREATE OR REPLACE FUNCTION learn.studio_comments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM learn.course_versions v WHERE v.id = OLD.version_id AND v.status = 'draft') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'learn: studio comments are never deleted';
  END IF;
  IF (NEW.id, NEW.version_id, NEW.author_id, NEW.target, NEW.body, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.version_id, OLD.author_id, OLD.target, OLD.body, OLD.created_at)
     OR OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'learn: a studio comment cannot be changed';
  END IF;
  RETURN NEW;
END
$$;
