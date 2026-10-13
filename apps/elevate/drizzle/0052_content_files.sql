CREATE TABLE "docs"."content_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"announcement_id" uuid,
	"policy_version_id" uuid,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_files_kind_chk" CHECK ("docs"."content_files"."kind" in ('image','file')),
	CONSTRAINT "content_files_one_parent_chk" CHECK ("docs"."content_files"."announcement_id" is null or "docs"."content_files"."policy_version_id" is null)
);
--> statement-breakpoint
ALTER TABLE "docs"."content_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "docs"."content_files" ADD CONSTRAINT "content_files_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "docs"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."content_files" ADD CONSTRAINT "content_files_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "docs"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_files_announcement_idx" ON "docs"."content_files" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "content_files_version_idx" ON "docs"."content_files" USING btree ("policy_version_id");--> statement-breakpoint
CREATE INDEX "content_files_pending_idx" ON "docs"."content_files" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "content_files_path_idx" ON "docs"."content_files" USING btree ("storage_path");
--> statement-breakpoint
-- The files of a PUBLISHED policy version are frozen with it: nothing can be added to, moved from or deleted from one, even with
-- direct database access. (A draft's files change freely; publishing the draft is what freezes them.)
CREATE OR REPLACE FUNCTION docs.guard_content_files() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.policy_version_id IS NOT NULL THEN
    SELECT status INTO v_status FROM docs.policy_versions WHERE id = OLD.policy_version_id;
    IF v_status = 'published' THEN
      RAISE EXCEPTION 'files of a published policy version cannot change';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.policy_version_id IS NOT NULL THEN
    SELECT status INTO v_status FROM docs.policy_versions WHERE id = NEW.policy_version_id;
    IF v_status = 'published' THEN
      RAISE EXCEPTION 'files of a published policy version cannot change';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER content_files_guard
  BEFORE INSERT OR UPDATE OR DELETE ON docs.content_files
  FOR EACH ROW EXECUTE FUNCTION docs.guard_content_files();
