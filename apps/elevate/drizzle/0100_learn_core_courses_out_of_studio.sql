-- The core courses (HIPAA, Cybersecurity, Customer Service) are written in the repository and published with `pnpm learn:publish`, not in
-- the Course studio (decided 2026-10-23). This makes that true for data that already exists:
--  1. a course that was ever edited in the studio is flagged studio_managed, which makes the publish command refuse it: clear the flag;
--  2. a studio DRAFT of one of these courses would no longer be visible or editable anywhere, so it is discarded (a draft was never live,
--     so nobody has taken it, and published versions are never touched; the module, question and comment rows of a draft go with it).
-- Client add-ons are unchanged and stay in the studio.
UPDATE "learn"."courses" SET "studio_managed" = false WHERE "slug" IN ('hipaa', 'cybersecurity', 'customer-service') AND "studio_managed";--> statement-breakpoint
DELETE FROM "learn"."studio_comments" WHERE "version_id" IN (
  SELECT v."id" FROM "learn"."course_versions" v JOIN "learn"."courses" c ON c."id" = v."course_id"
  WHERE c."slug" IN ('hipaa', 'cybersecurity', 'customer-service') AND v."status" = 'draft');--> statement-breakpoint
DELETE FROM "learn"."questions" WHERE "version_id" IN (
  SELECT v."id" FROM "learn"."course_versions" v JOIN "learn"."courses" c ON c."id" = v."course_id"
  WHERE c."slug" IN ('hipaa', 'cybersecurity', 'customer-service') AND v."status" = 'draft');--> statement-breakpoint
DELETE FROM "learn"."version_modules" WHERE "version_id" IN (
  SELECT v."id" FROM "learn"."course_versions" v JOIN "learn"."courses" c ON c."id" = v."course_id"
  WHERE c."slug" IN ('hipaa', 'cybersecurity', 'customer-service') AND v."status" = 'draft');--> statement-breakpoint
DELETE FROM "learn"."course_versions" WHERE "status" = 'draft' AND "course_id" IN (
  SELECT "id" FROM "learn"."courses" WHERE "slug" IN ('hipaa', 'cybersecurity', 'customer-service'));
