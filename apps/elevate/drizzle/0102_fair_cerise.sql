CREATE TABLE "docs"."storage_deletions" (
	"path" text PRIMARY KEY NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs"."storage_deletions" ENABLE ROW LEVEL SECURITY;