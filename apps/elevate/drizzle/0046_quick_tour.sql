ALTER TABLE "core"."users" ADD COLUMN "onboarding_tour_seen_at" timestamp with time zone;--> statement-breakpoint
-- People who already use ELEVATE have seen their way around: only accounts created from now on get the tour by themselves.
UPDATE "core"."users" SET "onboarding_tour_seen_at" = now() WHERE "onboarding_tour_seen_at" IS NULL;
