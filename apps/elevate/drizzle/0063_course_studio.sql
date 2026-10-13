ALTER TABLE "learn"."course_versions" ADD COLUMN "change_note" text;--> statement-breakpoint
ALTER TABLE "learn"."course_versions" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "learn"."course_versions" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "learn"."course_versions" ADD COLUMN "edit_stamp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD COLUMN "studio_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."questions" ADD COLUMN "lineage" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."course_versions" ADD CONSTRAINT "course_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The change note a studio editor writes is part of what is frozen when a version is published (the saved-by and stamp columns
-- move while it is a draft and are set at the moment of publishing, so they are not in the frozen list).
CREATE OR REPLACE FUNCTION learn.course_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'learn: a published course version cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status = 'retired' THEN RAISE EXCEPTION 'learn: a draft cannot be retired'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.course_id, NEW.version, NEW.content, NEW.exam_config, NEW.material, NEW.reviewed_by, NEW.counsel_approved_on, NEW.published_at, NEW.published_by, NEW.created_by, NEW.created_at, NEW.change_note)
     IS DISTINCT FROM
     (OLD.id, OLD.course_id, OLD.version, OLD.content, OLD.exam_config, OLD.material, OLD.reviewed_by, OLD.counsel_approved_on, OLD.published_at, OLD.published_by, OLD.created_by, OLD.created_at, OLD.change_note) THEN
    RAISE EXCEPTION 'learn: a published course version is frozen';
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN RAISE EXCEPTION 'learn: a retired version cannot be reopened'; END IF;
  IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'retired') THEN RAISE EXCEPTION 'learn: a published version can only be retired'; END IF;
  RETURN NEW;
END
$$;
