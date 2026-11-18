ALTER TABLE "chat"."call_participants" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."call_tracks" ADD COLUMN "mid" text;