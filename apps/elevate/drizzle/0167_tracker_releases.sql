CREATE TABLE "time"."tracker_release_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracker_release_builds_platform_check" CHECK ("time"."tracker_release_builds"."platform" in ('windows-x86_64', 'darwin-aarch64', 'darwin-x86_64')),
	CONSTRAINT "tracker_release_builds_kind_check" CHECK ("time"."tracker_release_builds"."kind" in ('installer', 'update')),
	CONSTRAINT "tracker_release_builds_signature_check" CHECK ("time"."tracker_release_builds"."kind" <> 'update' or ("time"."tracker_release_builds"."signature" is not null and length("time"."tracker_release_builds"."signature") > 0))
);
--> statement-breakpoint
ALTER TABLE "time"."tracker_release_builds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."tracker_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes_added" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes_improved" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes_fixed" text[] DEFAULT '{}'::text[] NOT NULL,
	"min_required" boolean DEFAULT false NOT NULL,
	"adds_collection" boolean DEFAULT false NOT NULL,
	"policy_version_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "tracker_releases_version_check" CHECK ("time"."tracker_releases"."version" ~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'),
	CONSTRAINT "tracker_releases_status_check" CHECK ("time"."tracker_releases"."status" in ('draft', 'published', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "time"."tracker_releases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."tracker_release_builds" ADD CONSTRAINT "tracker_release_builds_release_id_tracker_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "time"."tracker_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_release_builds_kind_idx" ON "time"."tracker_release_builds" USING btree ("release_id","platform","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_release_builds_path_idx" ON "time"."tracker_release_builds" USING btree ("storage_path");--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_releases_version_idx" ON "time"."tracker_releases" USING btree ("version");
--> statement-breakpoint
-- The policy version a release that adds new data collection was published under.
ALTER TABLE time.tracker_releases
  ADD CONSTRAINT tracker_releases_policy_version_fk FOREIGN KEY (policy_version_id) REFERENCES docs.policy_versions (id);
--> statement-breakpoint
-- A published release is frozen: only withdrawing it is allowed afterwards, and only a draft can be deleted.
CREATE OR REPLACE FUNCTION time.guard_tracker_release() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'a published release cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'published'
     AND NEW.status = 'withdrawn'
     AND NEW.withdrawn_at IS NOT NULL
     AND (to_jsonb(NEW) - 'status' - 'withdrawn_at') = (to_jsonb(OLD) - 'status' - 'withdrawn_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a published release is frozen: it can only be withdrawn';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tracker_releases_guard
  BEFORE UPDATE OR DELETE ON time.tracker_releases
  FOR EACH ROW EXECUTE FUNCTION time.guard_tracker_release();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION time.refuse_release_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'tracker releases cannot be truncated';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tracker_releases_no_truncate
  BEFORE TRUNCATE ON time.tracker_releases
  FOR EACH STATEMENT EXECUTE FUNCTION time.refuse_release_truncate();
--> statement-breakpoint
-- Builds belong to a draft: once the release is published they cannot be added, changed or removed.
CREATE OR REPLACE FUNCTION time.guard_tracker_release_build() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  parent_status text;
BEGIN
  -- The row as it was (an update or delete) and the row as it will be (an insert or update) must each belong to a draft, so a build
  -- cannot be moved out of a published release by changing its release_id.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO parent_status FROM time.tracker_releases WHERE id = OLD.release_id;
    IF parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'builds can only change while the release is a draft';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO parent_status FROM time.tracker_releases WHERE id = NEW.release_id;
    IF parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'builds can only change while the release is a draft';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tracker_release_builds_guard
  BEFORE INSERT OR UPDATE OR DELETE ON time.tracker_release_builds
  FOR EACH ROW EXECUTE FUNCTION time.guard_tracker_release_build();
--> statement-breakpoint
CREATE TRIGGER tracker_release_builds_no_truncate
  BEFORE TRUNCATE ON time.tracker_release_builds
  FOR EACH STATEMENT EXECUTE FUNCTION time.refuse_release_truncate();
