CREATE SCHEMA "talent";
--> statement-breakpoint
CREATE TABLE "talent"."application_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"by_user_id" uuid,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."application_stage_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opening_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"stage" text DEFAULT 'applied' NOT NULL,
	"close_kind" text,
	"close_reason" text,
	"note" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "applications_stage_chk" CHECK ("talent"."applications"."stage" in ('applied','screening','interview','assessment','offer','hired','rejected')),
	CONSTRAINT "applications_close_chk" CHECK (("talent"."applications"."stage" = 'rejected') = ("talent"."applications"."close_kind" is not null) and ("talent"."applications"."close_kind" is null or "talent"."applications"."close_kind" in ('rejected','withdrawn')))
);
--> statement-breakpoint
ALTER TABLE "talent"."applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."candidate_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid,
	"to_email" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"attachment" jsonb,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "candidate_emails_kind_chk" CHECK ("talent"."candidate_emails"."kind" in ('received','rejection','interview')),
	CONSTRAINT "candidate_emails_status_chk" CHECK ("talent"."candidate_emails"."status" in ('queued','sent','failed','skipped'))
);
--> statement-breakpoint
ALTER TABLE "talent"."candidate_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."candidate_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."candidate_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"country" text,
	"consent_notice_version" text,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resume_path" text,
	"resume_name" text,
	"resume_kind" text,
	"resume_sha256" text,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."interviewers" (
	"interview_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "interviewers_interview_id_user_id_pk" PRIMARY KEY("interview_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "talent"."interviewers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" text DEFAULT 'interview' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"minutes" smallint NOT NULL,
	"location" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interviews_status_chk" CHECK ("talent"."interviews"."status" in ('scheduled','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "talent"."interviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."job_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"location" text DEFAULT 'Remote' NOT NULL,
	"pay_note" text,
	"team_id" uuid,
	"client_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"send_ack" boolean DEFAULT true NOT NULL,
	"send_rejection" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_openings_status_chk" CHECK ("talent"."job_openings"."status" in ('draft','open','closed'))
);
--> statement-breakpoint
ALTER TABLE "talent"."job_openings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."opening_hiring_team" (
	"opening_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "opening_hiring_team_opening_id_user_id_pk" PRIMARY KEY("opening_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "talent"."opening_hiring_team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."recruiting_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"retention_enabled" boolean DEFAULT false NOT NULL,
	"rejected_months" smallint DEFAULT 12 NOT NULL,
	"withdrawn_months" smallint DEFAULT 6 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruiting_settings_one_row" CHECK ("talent"."recruiting_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "talent"."recruiting_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"interviewer_id" uuid NOT NULL,
	"ratings" jsonb NOT NULL,
	"recommendation" text NOT NULL,
	"comments" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scorecards_recommendation_chk" CHECK ("talent"."scorecards"."recommendation" in ('strong_yes','yes','no','strong_no'))
);
--> statement-breakpoint
ALTER TABLE "talent"."scorecards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."application_stage_history" ADD CONSTRAINT "application_stage_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "talent"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."application_stage_history" ADD CONSTRAINT "application_stage_history_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD CONSTRAINT "applications_opening_id_job_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "talent"."job_openings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "talent"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."candidate_emails" ADD CONSTRAINT "candidate_emails_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "talent"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."candidate_notes" ADD CONSTRAINT "candidate_notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "talent"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."candidate_notes" ADD CONSTRAINT "candidate_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."interviewers" ADD CONSTRAINT "interviewers_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "talent"."interviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."interviewers" ADD CONSTRAINT "interviewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "talent"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."interviews" ADD CONSTRAINT "interviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."job_openings" ADD CONSTRAINT "job_openings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "core"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."job_openings" ADD CONSTRAINT "job_openings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."job_openings" ADD CONSTRAINT "job_openings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."opening_hiring_team" ADD CONSTRAINT "opening_hiring_team_opening_id_job_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "talent"."job_openings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."opening_hiring_team" ADD CONSTRAINT "opening_hiring_team_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."recruiting_settings" ADD CONSTRAINT "recruiting_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."scorecards" ADD CONSTRAINT "scorecards_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "talent"."interviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."scorecards" ADD CONSTRAINT "scorecards_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "talent"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."scorecards" ADD CONSTRAINT "scorecards_interviewer_id_users_id_fk" FOREIGN KEY ("interviewer_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_stage_history_app_idx" ON "talent"."application_stage_history" USING btree ("application_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_opening_candidate_idx" ON "talent"."applications" USING btree ("opening_id","candidate_id");--> statement-breakpoint
CREATE INDEX "applications_opening_stage_idx" ON "talent"."applications" USING btree ("opening_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_emails_dedupe_idx" ON "talent"."candidate_emails" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "candidate_emails_pending_idx" ON "talent"."candidate_emails" USING btree ("created_at") WHERE "talent"."candidate_emails"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "candidate_notes_app_idx" ON "talent"."candidate_notes" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_email_idx" ON "talent"."candidates" USING btree (lower("email")) WHERE "talent"."candidates"."anonymized_at" is null;--> statement-breakpoint
CREATE INDEX "interviews_app_idx" ON "talent"."interviews" USING btree ("application_id","starts_at");--> statement-breakpoint
CREATE INDEX "job_openings_status_idx" ON "talent"."job_openings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecards_interview_interviewer_idx" ON "talent"."scorecards" USING btree ("interview_id","interviewer_id");--> statement-breakpoint
CREATE INDEX "scorecards_app_idx" ON "talent"."scorecards" USING btree ("application_id");
--> statement-breakpoint
-- Stage history and scorecards are evidence: nobody edits or removes them, even with direct database access. The one exception is
-- the retention job, which sets talent.retention for its own transaction so it can erase an expired applicant's personal data.
CREATE OR REPLACE FUNCTION talent.reject_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'TRUNCATE' AND current_setting('talent.retention', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER application_stage_history_append_only BEFORE UPDATE OR DELETE ON talent.application_stage_history FOR EACH ROW EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
CREATE TRIGGER application_stage_history_no_truncate BEFORE TRUNCATE ON talent.application_stage_history FOR EACH STATEMENT EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
CREATE TRIGGER scorecards_append_only BEFORE UPDATE OR DELETE ON talent.scorecards FOR EACH ROW EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
CREATE TRIGGER scorecards_no_truncate BEFORE TRUNCATE ON talent.scorecards FOR EACH STATEMENT EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
INSERT INTO talent.recruiting_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
