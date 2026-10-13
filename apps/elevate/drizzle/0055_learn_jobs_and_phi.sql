CREATE TABLE "learn"."certificate_sync" (
	"certificate_id" uuid PRIMARY KEY NOT NULL,
	"credential_id" uuid NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learn"."certificate_sync" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."reminders" (
	"assignment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_assignment_id_kind_pk" PRIMARY KEY("assignment_id","kind"),
	CONSTRAINT "reminders_kind_chk" CHECK ("learn"."reminders"."kind" ~ '^(d30|d7|d0|overdue-[0-9]{4}-W[0-9]{2})$')
);
--> statement-breakpoint
ALTER TABLE "learn"."reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."credentials" DROP CONSTRAINT "credentials_source_chk";--> statement-breakpoint
ALTER TABLE "core"."clients" ADD COLUMN "handles_phi" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."certificate_sync" ADD CONSTRAINT "certificate_sync_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "learn"."certificates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."reminders" ADD CONSTRAINT "reminders_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."credentials" ADD CONSTRAINT "credentials_source_chk" CHECK ("talent"."credentials"."source" in ('manual','talenthr','learn'));--> statement-breakpoint
-- Retention: per-question answers are removed 12 months after the exam was submitted (the score, the pass result, the attestation and
-- the certificate stay for six years). Nothing else may delete an answer: only the retention job, which sets learn.purge = 'on' for its
-- own transaction, and only for attempts submitted more than 12 months ago.
CREATE OR REPLACE FUNCTION learn.exam_answers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('learn.purge', true), '') = 'on'
       AND EXISTS (SELECT 1 FROM learn.exam_attempts a WHERE a.id = OLD.attempt_id AND a.status = 'submitted' AND a.submitted_at < now() - interval '12 months') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'learn: exam answers are never deleted';
  END IF;
  SELECT status INTO v_status FROM learn.exam_attempts WHERE id = NEW.attempt_id;
  IF v_status IS DISTINCT FROM 'in_progress' THEN RAISE EXCEPTION 'learn: a submitted exam cannot be changed'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.attempt_id, NEW.question_id) IS DISTINCT FROM (OLD.attempt_id, OLD.question_id) THEN
    RAISE EXCEPTION 'learn: an answer cannot be moved to another question';
  END IF;
  RETURN NEW;
END
$$;
