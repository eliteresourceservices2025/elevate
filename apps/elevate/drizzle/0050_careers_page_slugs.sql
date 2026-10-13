CREATE TABLE "talent"."careers_page" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"title" text,
	"intro" text,
	"banner_path" text,
	"banner_updated_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "careers_page_single_chk" CHECK ("talent"."careers_page"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "talent"."careers_page" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."job_openings" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "talent"."careers_page" ADD CONSTRAINT "careers_page_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Readable addresses for jobs that already exist: the title in lower case with dashes; a repeat gets a short piece of its id.
WITH base AS (
  SELECT id, created_at,
         COALESCE(NULLIF(trim(both '-' from left(lower(regexp_replace(title, '[^a-zA-Z0-9]+', '-', 'g')), 60)), ''), 'job') AS s
  FROM talent.job_openings
), ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY created_at, id) AS n FROM base
)
UPDATE talent.job_openings j
SET slug = CASE WHEN r.n = 1 THEN r.s ELSE left(r.s, 53) || '-' || substr(j.id::text, 1, 6) END
FROM ranked r WHERE j.id = r.id;
--> statement-breakpoint
-- The single careers page settings row.
INSERT INTO talent.careers_page (id) VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE UNIQUE INDEX "job_openings_slug_idx" ON "talent"."job_openings" USING btree (lower("slug")) WHERE "talent"."job_openings"."slug" is not null;