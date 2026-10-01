CREATE TABLE "ops"."job_runs" (
	"job" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"runs" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."job_runs" ENABLE ROW LEVEL SECURITY;