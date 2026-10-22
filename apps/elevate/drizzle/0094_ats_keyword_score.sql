ALTER TABLE "talent"."applications" ADD COLUMN "keyword_score" smallint;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD COLUMN "keyword_matched" jsonb;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD COLUMN "keyword_missed" jsonb;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD COLUMN "keyword_scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD COLUMN "keyword_set_key" text;--> statement-breakpoint
ALTER TABLE "talent"."job_openings" ADD COLUMN "keywords_required" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "talent"."job_openings" ADD COLUMN "keywords_nice" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD CONSTRAINT "applications_keyword_score_chk" CHECK ("talent"."applications"."keyword_score" is null or "talent"."applications"."keyword_score" between 0 and 100);