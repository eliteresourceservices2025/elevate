CREATE TABLE "learn"."studio_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"target" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "studio_comments_target_chk" CHECK ("learn"."studio_comments"."target" ~ '^(course|module:[a-z0-9_]{1,40})$'),
	CONSTRAINT "studio_comments_body_chk" CHECK (char_length("learn"."studio_comments"."body") between 3 and 1000),
	CONSTRAINT "studio_comments_resolved_chk" CHECK (("learn"."studio_comments"."resolved_at" is null) = ("learn"."studio_comments"."resolved_by" is null))
);
--> statement-breakpoint
ALTER TABLE "learn"."studio_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learn"."studio_comments" ADD CONSTRAINT "studio_comments_version_id_course_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "learn"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."studio_comments" ADD CONSTRAINT "studio_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."studio_comments" ADD CONSTRAINT "studio_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_comments_version_idx" ON "learn"."studio_comments" USING btree ("version_id","created_at");
--> statement-breakpoint
-- Comments are working notes between editors, read and written only by ELEVATE's owner connection (the Learn app has no grant).
-- The text never changes; the only allowed update marks a comment resolved, once. Nothing is deleted.
CREATE FUNCTION learn.studio_comments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: studio comments are never deleted'; END IF;
  IF (NEW.id, NEW.version_id, NEW.author_id, NEW.target, NEW.body, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.version_id, OLD.author_id, OLD.target, OLD.body, OLD.created_at)
     OR OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'learn: a studio comment cannot be changed';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER studio_comments_guard BEFORE UPDATE OR DELETE ON learn.studio_comments FOR EACH ROW EXECUTE FUNCTION learn.studio_comments_guard();--> statement-breakpoint
REVOKE ALL ON FUNCTION learn.studio_comments_guard() FROM PUBLIC;
