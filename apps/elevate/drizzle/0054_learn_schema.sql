CREATE SCHEMA "learn";
--> statement-breakpoint
CREATE TABLE "learn"."assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"track" text NOT NULL,
	"reason" text NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"passed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "assignments_track_chk" CHECK ("learn"."assignments"."track" in ('full','essentials','refresher')),
	CONSTRAINT "assignments_reason_chk" CHECK ("learn"."assignments"."reason" in ('new_hire','renewal','update','manual')),
	CONSTRAINT "assignments_status_chk" CHECK ("learn"."assignments"."status" in ('assigned','in_progress','passed','expired','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "learn"."assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"statement_version" text NOT NULL,
	"typed_name" text NOT NULL,
	"ip" text,
	"auth_methods" text[] DEFAULT '{}'::text[] NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attestations_name_chk" CHECK (char_length("learn"."attestations"."typed_name") between 2 and 120)
);
--> statement-breakpoint
ALTER TABLE "learn"."attestations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."certificate_revocations" (
	"certificate_id" uuid PRIMARY KEY NOT NULL,
	"revoked_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_revocations_reason_chk" CHECK (char_length("learn"."certificate_revocations"."reason") between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "learn"."certificate_revocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"track" text NOT NULL,
	"holder_name" text NOT NULL,
	"issued_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"pdf_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificates_reference_chk" CHECK ("learn"."certificates"."reference" ~ '^HC-[0-9]{4}-[A-Z2-9]{6}$'),
	CONSTRAINT "certificates_dates_chk" CHECK ("learn"."certificates"."issued_on" < "learn"."certificates"."ends_on")
);
--> statement-breakpoint
ALTER TABLE "learn"."certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."course_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exam_config" jsonb NOT NULL,
	"material" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"counsel_approved_on" date,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"retired_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_versions_status_chk" CHECK ("learn"."course_versions"."status" in ('draft','published','retired')),
	CONSTRAINT "course_versions_published_chk" CHECK (("learn"."course_versions"."status" = 'draft') or ("learn"."course_versions"."published_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "learn"."course_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "courses_slug_chk" CHECK ("learn"."courses"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "learn"."courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."exam_answers" (
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_ids" text[] NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_answers_attempt_id_question_id_pk" PRIMARY KEY("attempt_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "learn"."exam_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."exam_attempt_items" (
	"attempt_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"question_id" uuid NOT NULL,
	"option_order" text[] NOT NULL,
	CONSTRAINT "exam_attempt_items_attempt_id_position_pk" PRIMARY KEY("attempt_id","position")
);
--> statement-breakpoint
ALTER TABLE "learn"."exam_attempt_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."exam_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_no" smallint NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"total_count" smallint NOT NULL,
	"correct_count" smallint,
	"score_percent" numeric(5, 2),
	"passed" boolean,
	CONSTRAINT "exam_attempts_status_chk" CHECK ("learn"."exam_attempts"."status" in ('in_progress','submitted')),
	CONSTRAINT "exam_attempts_done_chk" CHECK (("learn"."exam_attempts"."status" = 'submitted') = ("learn"."exam_attempts"."submitted_at" is not null and "learn"."exam_attempts"."passed" is not null))
);
--> statement-breakpoint
ALTER TABLE "learn"."exam_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."launch_tokens" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_methods" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learn"."launch_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."module_completions" (
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_completions_assignment_id_module_key_pk" PRIMARY KEY("assignment_id","module_key")
);
--> statement-breakpoint
ALTER TABLE "learn"."module_completions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."module_screens" (
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"screen_index" smallint NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_screens_assignment_id_module_key_screen_index_pk" PRIMARY KEY("assignment_id","module_key","screen_index")
);
--> statement-breakpoint
ALTER TABLE "learn"."module_screens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."module_time" (
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"day" date NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"last_credit_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_time_assignment_id_module_key_day_pk" PRIMARY KEY("assignment_id","module_key","day"),
	CONSTRAINT "module_time_seconds_chk" CHECK ("learn"."module_time"."seconds" between 0 and 14400)
);
--> statement-breakpoint
ALTER TABLE "learn"."module_time" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"topic" text NOT NULL,
	"type" text NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_ids" text[] NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_type_chk" CHECK ("learn"."questions"."type" in ('single','multiple','true_false','scenario')),
	CONSTRAINT "questions_options_chk" CHECK (jsonb_typeof("learn"."questions"."options") = 'array' and jsonb_array_length("learn"."questions"."options") between 2 and 8),
	CONSTRAINT "questions_correct_chk" CHECK (cardinality("learn"."questions"."correct_ids") between 1 and 8),
	CONSTRAINT "questions_text_chk" CHECK (char_length("learn"."questions"."stem") between 5 and 1500 and char_length("learn"."questions"."rationale") between 5 and 2000)
);
--> statement-breakpoint
ALTER TABLE "learn"."questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."retry_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"extra_tries" smallint DEFAULT 0 NOT NULL,
	"extra_minutes" smallint DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retry_grants_kind_chk" CHECK ("learn"."retry_grants"."kind" in ('tries','time')),
	CONSTRAINT "retry_grants_amount_chk" CHECK (("learn"."retry_grants"."kind" = 'tries' and "learn"."retry_grants"."extra_tries" between 1 and 5 and "learn"."retry_grants"."extra_minutes" = 0) or ("learn"."retry_grants"."kind" = 'time' and "learn"."retry_grants"."extra_minutes" between 5 and 60 and "learn"."retry_grants"."extra_tries" = 0)),
	CONSTRAINT "retry_grants_reason_chk" CHECK (char_length("learn"."retry_grants"."reason") between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "learn"."retry_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_methods" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "learn"."sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."version_modules" (
	"version_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"position" smallint NOT NULL,
	"title" text NOT NULL,
	"estimated_minutes" smallint NOT NULL,
	"min_seconds" integer NOT NULL,
	"screen_count" smallint NOT NULL,
	"tracks" text[] NOT NULL,
	CONSTRAINT "version_modules_version_id_module_key_pk" PRIMARY KEY("version_id","module_key"),
	CONSTRAINT "version_modules_key_chk" CHECK ("learn"."version_modules"."module_key" ~ '^[a-z0-9_]{1,40}$'),
	CONSTRAINT "version_modules_time_chk" CHECK ("learn"."version_modules"."min_seconds" between 0 and 7200 and "learn"."version_modules"."estimated_minutes" between 1 and 120),
	CONSTRAINT "version_modules_screens_chk" CHECK ("learn"."version_modules"."screen_count" between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "learn"."version_modules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learn"."assignments" ADD CONSTRAINT "assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignments" ADD CONSTRAINT "assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignments" ADD CONSTRAINT "assignments_version_id_course_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "learn"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignments" ADD CONSTRAINT "assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."attestations" ADD CONSTRAINT "attestations_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."attestations" ADD CONSTRAINT "attestations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificate_revocations" ADD CONSTRAINT "certificate_revocations_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "learn"."certificates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificate_revocations" ADD CONSTRAINT "certificate_revocations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificates" ADD CONSTRAINT "certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificates" ADD CONSTRAINT "certificates_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificates" ADD CONSTRAINT "certificates_version_id_course_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "learn"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_versions" ADD CONSTRAINT "course_versions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_versions" ADD CONSTRAINT "course_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_versions" ADD CONSTRAINT "course_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_versions" ADD CONSTRAINT "course_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."exam_answers" ADD CONSTRAINT "exam_answers_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "learn"."exam_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."exam_answers" ADD CONSTRAINT "exam_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "learn"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."exam_attempt_items" ADD CONSTRAINT "exam_attempt_items_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "learn"."exam_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."exam_attempt_items" ADD CONSTRAINT "exam_attempt_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "learn"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."exam_attempts" ADD CONSTRAINT "exam_attempts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."exam_attempts" ADD CONSTRAINT "exam_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."launch_tokens" ADD CONSTRAINT "launch_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."module_completions" ADD CONSTRAINT "module_completions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."module_completions" ADD CONSTRAINT "module_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."module_screens" ADD CONSTRAINT "module_screens_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."module_screens" ADD CONSTRAINT "module_screens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."module_time" ADD CONSTRAINT "module_time_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."module_time" ADD CONSTRAINT "module_time_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."questions" ADD CONSTRAINT "questions_version_id_course_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "learn"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."retry_grants" ADD CONSTRAINT "retry_grants_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."retry_grants" ADD CONSTRAINT "retry_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."retry_grants" ADD CONSTRAINT "retry_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."version_modules" ADD CONSTRAINT "version_modules_version_id_course_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "learn"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_open_idx" ON "learn"."assignments" USING btree ("user_id","course_id") WHERE "learn"."assignments"."status" in ('assigned','in_progress');--> statement-breakpoint
CREATE INDEX "assignments_due_idx" ON "learn"."assignments" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "assignments_user_idx" ON "learn"."assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attestations_assignment_idx" ON "learn"."attestations" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_reference_idx" ON "learn"."certificates" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_assignment_idx" ON "learn"."certificates" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "certificates_user_idx" ON "learn"."certificates" USING btree ("user_id","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "course_versions_number_idx" ON "learn"."course_versions" USING btree ("course_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "course_versions_published_idx" ON "learn"."course_versions" USING btree ("course_id") WHERE "learn"."course_versions"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "courses_slug_idx" ON "learn"."courses" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_attempt_items_question_idx" ON "learn"."exam_attempt_items" USING btree ("attempt_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_attempts_number_idx" ON "learn"."exam_attempts" USING btree ("assignment_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_attempts_open_idx" ON "learn"."exam_attempts" USING btree ("assignment_id") WHERE "learn"."exam_attempts"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "launch_tokens_expiry_idx" ON "learn"."launch_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "questions_version_idx" ON "learn"."questions" USING btree ("version_id","module_key");--> statement-breakpoint
CREATE INDEX "retry_grants_assignment_idx" ON "learn"."retry_grants" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "learn"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "learn"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "version_modules_position_idx" ON "learn"."version_modules" USING btree ("version_id","position");--> statement-breakpoint
-- ============================================================================================================================
-- ELEVATE Learn: roles, grants, row-level security, guards, views and functions (hand-written part of migration 0054).
-- Design: docs/learn/03-data-and-security.md. The Learn app's role (learn_app) can only SELECT its own rows and EXECUTE the
-- functions below. It never reads the answer key (questions.correct_ids, questions.rationale), never writes a table directly,
-- and has no access to any other schema. NOLOGIN on purpose: ops sets the password out of band
-- (ALTER ROLE learn_app LOGIN PASSWORD '...'), so no secret is ever in this repository.
-- ============================================================================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'learn_app') THEN
    CREATE ROLE learn_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA learn TO learn_app;--> statement-breakpoint
-- The person the request is for: the app sets it for each transaction (select set_config('learn.user_id', '<uuid>', true)).
CREATE FUNCTION learn.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('learn.user_id', true), '')::uuid
$$;--> statement-breakpoint

-- ---- What the app role may read ---------------------------------------------------------------------------------------
GRANT SELECT ON learn.courses, learn.version_modules, learn.assignments, learn.module_screens, learn.module_time,
  learn.module_completions, learn.retry_grants, learn.exam_attempts, learn.exam_attempt_items, learn.exam_answers,
  learn.attestations, learn.certificates, learn.certificate_revocations TO learn_app;--> statement-breakpoint
GRANT SELECT (id, course_id, version, status, content, exam_config, material, published_at) ON learn.course_versions TO learn_app;--> statement-breakpoint
-- The question text and options, but NOT the key: correct_ids and rationale have no column grant.
GRANT SELECT (id, version_id, module_key, topic, type, stem, options) ON learn.questions TO learn_app;--> statement-breakpoint

CREATE POLICY learn_app_read ON learn.courses FOR SELECT TO learn_app USING (archived_at IS NULL);--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.course_versions FOR SELECT TO learn_app USING (
  status = 'published' OR EXISTS (SELECT 1 FROM learn.assignments a WHERE a.version_id = course_versions.id AND a.user_id = learn.current_user_id())
);--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.version_modules FOR SELECT TO learn_app USING (true);--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.questions FOR SELECT TO learn_app USING (
  EXISTS (
    SELECT 1 FROM learn.exam_attempt_items i JOIN learn.exam_attempts x ON x.id = i.attempt_id
    WHERE i.question_id = questions.id AND x.user_id = learn.current_user_id()
  )
);--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.assignments FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.module_screens FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.module_time FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.module_completions FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.retry_grants FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.exam_attempts FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.exam_attempt_items FOR SELECT TO learn_app USING (
  EXISTS (SELECT 1 FROM learn.exam_attempts x WHERE x.id = exam_attempt_items.attempt_id AND x.user_id = learn.current_user_id())
);--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.exam_answers FOR SELECT TO learn_app USING (
  EXISTS (SELECT 1 FROM learn.exam_attempts x WHERE x.id = exam_answers.attempt_id AND x.user_id = learn.current_user_id())
);--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.attestations FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.certificates FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.certificate_revocations FOR SELECT TO learn_app USING (
  EXISTS (SELECT 1 FROM learn.certificates c WHERE c.id = certificate_revocations.certificate_id AND c.user_id = learn.current_user_id())
);--> statement-breakpoint

-- ---- Views ------------------------------------------------------------------------------------------------------------
-- Is this account still allowed in? (archived accounts and separated people are not.)
CREATE FUNCTION learn.user_is_active(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM core.users u WHERE u.id = p_user AND u.archived_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM core.employees e WHERE e.user_id = p_user AND e.archived_at IS NULL AND e.status = 'separated')
$$;--> statement-breakpoint
-- The signed-in person only (never a list of people): name, work email, team and whether they are still active.
CREATE VIEW learn.v_learners AS
  SELECT u.id AS user_id,
         u.email AS email,
         coalesce(nullif(btrim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), ''), split_part(u.email, '@', 1)) AS display_name,
         nullif(btrim(e.legal_first_name || ' ' || e.legal_last_name), '') AS legal_name,
         e.team_id AS team_id,
         e.start_date AS start_date,
         (u.archived_at IS NULL AND (e.id IS NULL OR e.status <> 'separated')) AS active
  FROM core.users u
  LEFT JOIN LATERAL (
    SELECT * FROM core.employees x WHERE x.user_id = u.id AND x.archived_at IS NULL ORDER BY x.created_at DESC LIMIT 1
  ) e ON true
  WHERE u.id = learn.current_user_id();--> statement-breakpoint
-- The signed-in person's ELEVATE roles, and what the studio and reports allow (decided here once, used by the app).
CREATE VIEW learn.v_staff_roles AS
  SELECT ur.user_id AS user_id,
         array_agg(ur.role_slug ORDER BY ur.role_slug) AS roles,
         bool_or(ur.role_slug IN ('super_admin', 'hr_admin')) AS can_manage_course,
         bool_or(ur.role_slug IN ('super_admin', 'hr_admin')) AS can_view_results
  FROM core.user_roles ur
  WHERE ur.user_id = learn.current_user_id()
  GROUP BY ur.user_id;--> statement-breakpoint
GRANT SELECT ON learn.v_learners, learn.v_staff_roles TO learn_app;--> statement-breakpoint
-- Status without scores, for ELEVATE (team leads see this and nothing more). Not granted to the app role.
CREATE VIEW learn.v_status AS
  SELECT a.id AS assignment_id, a.user_id, a.course_id, a.track, a.reason, a.status, a.due_on, a.assigned_at, a.passed_at,
         c.ends_on AS certificate_ends_on, (r.certificate_id IS NOT NULL) AS certificate_revoked
  FROM learn.assignments a
  LEFT JOIN learn.certificates c ON c.assignment_id = a.id
  LEFT JOIN learn.certificate_revocations r ON r.certificate_id = c.id;--> statement-breakpoint

-- ---- Guards: frozen versions and append-only evidence -----------------------------------------------------------------
CREATE FUNCTION learn.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'learn: % on learn.% is not allowed (training records are append-only)', TG_OP, TG_TABLE_NAME;
END
$$;--> statement-breakpoint
CREATE TRIGGER module_completions_append_only BEFORE UPDATE OR DELETE ON learn.module_completions FOR EACH ROW EXECUTE FUNCTION learn.reject_change();--> statement-breakpoint
CREATE TRIGGER module_screens_append_only BEFORE UPDATE OR DELETE ON learn.module_screens FOR EACH ROW EXECUTE FUNCTION learn.reject_change();--> statement-breakpoint
CREATE TRIGGER retry_grants_append_only BEFORE UPDATE OR DELETE ON learn.retry_grants FOR EACH ROW EXECUTE FUNCTION learn.reject_change();--> statement-breakpoint
CREATE TRIGGER attestations_append_only BEFORE UPDATE OR DELETE ON learn.attestations FOR EACH ROW EXECUTE FUNCTION learn.reject_change();--> statement-breakpoint
CREATE TRIGGER certificates_append_only BEFORE UPDATE OR DELETE ON learn.certificates FOR EACH ROW EXECUTE FUNCTION learn.reject_change();--> statement-breakpoint
CREATE TRIGGER certificate_revocations_append_only BEFORE UPDATE OR DELETE ON learn.certificate_revocations FOR EACH ROW EXECUTE FUNCTION learn.reject_change();--> statement-breakpoint
CREATE TRIGGER exam_attempt_items_append_only BEFORE UPDATE OR DELETE ON learn.exam_attempt_items FOR EACH ROW EXECUTE FUNCTION learn.reject_change();--> statement-breakpoint

-- A published course version is frozen; it can only be retired. Its modules and questions change only while it is a draft.
CREATE FUNCTION learn.course_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'learn: a published course version cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status = 'retired' THEN RAISE EXCEPTION 'learn: a draft cannot be retired'; END IF;
    RETURN NEW;
  END IF;
  -- published or retired: nothing about the content may change
  IF (NEW.id, NEW.course_id, NEW.version, NEW.content, NEW.exam_config, NEW.material, NEW.reviewed_by, NEW.counsel_approved_on, NEW.published_at, NEW.published_by, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.course_id, OLD.version, OLD.content, OLD.exam_config, OLD.material, OLD.reviewed_by, OLD.counsel_approved_on, OLD.published_at, OLD.published_by, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'learn: a published course version is frozen';
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN RAISE EXCEPTION 'learn: a retired version cannot be reopened'; END IF;
  IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'retired') THEN RAISE EXCEPTION 'learn: a published version can only be retired'; END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER course_versions_guard BEFORE UPDATE OR DELETE ON learn.course_versions FOR EACH ROW EXECUTE FUNCTION learn.course_versions_guard();--> statement-breakpoint
CREATE FUNCTION learn.version_children_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM learn.course_versions WHERE id = coalesce(NEW.version_id, OLD.version_id);
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'learn: the modules and questions of a published version are frozen';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER version_modules_guard BEFORE INSERT OR UPDATE OR DELETE ON learn.version_modules FOR EACH ROW EXECUTE FUNCTION learn.version_children_guard();--> statement-breakpoint
CREATE TRIGGER questions_guard BEFORE INSERT OR UPDATE OR DELETE ON learn.questions FOR EACH ROW EXECUTE FUNCTION learn.version_children_guard();--> statement-breakpoint

-- Time only ever grows, and a row is never removed.
CREATE FUNCTION learn.module_time_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: training time cannot be deleted'; END IF;
  IF (NEW.assignment_id, NEW.user_id, NEW.module_key, NEW.day) IS DISTINCT FROM (OLD.assignment_id, OLD.user_id, OLD.module_key, OLD.day) OR NEW.seconds < OLD.seconds THEN
    RAISE EXCEPTION 'learn: training time can only grow';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER module_time_guard BEFORE UPDATE OR DELETE ON learn.module_time FOR EACH ROW EXECUTE FUNCTION learn.module_time_guard();--> statement-breakpoint

-- An assignment's identity never changes and its status only moves forward (the due date may be extended by HR).
CREATE FUNCTION learn.assignments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: assignments are never deleted'; END IF;
  IF (NEW.id, NEW.user_id, NEW.course_id, NEW.version_id, NEW.track, NEW.reason, NEW.assigned_at, NEW.created_by)
     IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.course_id, OLD.version_id, OLD.track, OLD.reason, OLD.assigned_at, OLD.created_by) THEN
    RAISE EXCEPTION 'learn: an assignment cannot be rewritten';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'assigned' AND NEW.status IN ('in_progress', 'cancelled', 'expired'))
    OR (OLD.status = 'in_progress' AND NEW.status IN ('passed', 'cancelled', 'expired'))
    OR (OLD.status = 'passed' AND NEW.status = 'expired')
  ) THEN
    RAISE EXCEPTION 'learn: assignment status cannot go from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER assignments_guard BEFORE UPDATE OR DELETE ON learn.assignments FOR EACH ROW EXECUTE FUNCTION learn.assignments_guard();--> statement-breakpoint

-- An attempt is submitted once; after that nothing about it changes.
CREATE FUNCTION learn.exam_attempts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: exam attempts are never deleted'; END IF;
  IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'learn: a submitted exam attempt cannot change'; END IF;
  IF (NEW.id, NEW.assignment_id, NEW.user_id, NEW.attempt_no, NEW.started_at, NEW.deadline_at, NEW.total_count)
     IS DISTINCT FROM (OLD.id, OLD.assignment_id, OLD.user_id, OLD.attempt_no, OLD.started_at, OLD.deadline_at, OLD.total_count) THEN
    RAISE EXCEPTION 'learn: an exam attempt cannot be rewritten';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER exam_attempts_guard BEFORE UPDATE OR DELETE ON learn.exam_attempts FOR EACH ROW EXECUTE FUNCTION learn.exam_attempts_guard();--> statement-breakpoint

-- Answers can be changed while the attempt is open and are final once it is submitted. Never deleted.
CREATE FUNCTION learn.exam_answers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: exam answers are never deleted'; END IF;
  SELECT status INTO v_status FROM learn.exam_attempts WHERE id = NEW.attempt_id;
  IF v_status IS DISTINCT FROM 'in_progress' THEN RAISE EXCEPTION 'learn: a submitted exam cannot be changed'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.attempt_id, NEW.question_id) IS DISTINCT FROM (OLD.attempt_id, OLD.question_id) THEN
    RAISE EXCEPTION 'learn: an answer cannot be moved to another question';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER exam_answers_guard BEFORE INSERT OR UPDATE OR DELETE ON learn.exam_answers FOR EACH ROW EXECUTE FUNCTION learn.exam_answers_guard();--> statement-breakpoint

-- ---- Functions the app role may run (each runs as the table owner, so the app needs no write grant) --------------------
-- Errors are raised as 'learn:<code>' so the app can show a plain message without leaking anything else.

-- The modules a track includes, in order.
CREATE FUNCTION learn.track_modules(p_version uuid, p_track text) RETURNS SETOF learn.version_modules LANGUAGE sql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
  SELECT * FROM learn.version_modules WHERE version_id = p_version AND p_track = ANY (tracks) ORDER BY position
$$;--> statement-breakpoint

-- Internal: the open assignment of a person, or an error.
CREATE FUNCTION learn.open_assignment(p_user uuid, p_assignment uuid) RETURNS learn.assignments LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE a learn.assignments;
BEGIN
  SELECT * INTO a FROM learn.assignments WHERE id = p_assignment AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF a.status NOT IN ('assigned', 'in_progress') THEN RAISE EXCEPTION 'learn:not_open'; END IF;
  IF NOT learn.user_is_active(p_user) THEN RAISE EXCEPTION 'learn:inactive'; END IF;
  RETURN a;
END
$$;--> statement-breakpoint

-- Internal: raises unless the module belongs to the track and every earlier module of the track is complete.
CREATE FUNCTION learn.check_module_unlocked(a learn.assignments, p_module text) RETURNS learn.version_modules LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE m learn.version_modules;
BEGIN
  SELECT * INTO m FROM learn.version_modules WHERE version_id = a.version_id AND module_key = p_module AND a.track = ANY (tracks);
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:no_such_module'; END IF;
  IF EXISTS (
    SELECT 1 FROM learn.track_modules(a.version_id, a.track) t
    WHERE t.position < m.position
      AND NOT EXISTS (SELECT 1 FROM learn.module_completions c WHERE c.assignment_id = a.id AND c.module_key = t.module_key)
  ) THEN RAISE EXCEPTION 'learn:module_locked'; END IF;
  RETURN m;
END
$$;--> statement-breakpoint

-- The person opened a screen of a module.
CREATE FUNCTION learn.open_screen(p_user uuid, p_assignment uuid, p_module text, p_screen int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE a learn.assignments; m learn.version_modules;
BEGIN
  a := learn.open_assignment(p_user, p_assignment);
  m := learn.check_module_unlocked(a, p_module);
  IF p_screen < 0 OR p_screen >= m.screen_count THEN RAISE EXCEPTION 'learn:no_such_screen'; END IF;
  INSERT INTO learn.module_screens (assignment_id, user_id, module_key, screen_index) VALUES (a.id, p_user, p_module, p_screen) ON CONFLICT DO NOTHING;
  IF a.status = 'assigned' THEN UPDATE learn.assignments SET status = 'in_progress' WHERE id = a.id; END IF;
END
$$;--> statement-breakpoint

-- A heartbeat from the player. The server decides how much time counts: at most 35 seconds, and nothing if the previous credit
-- for this module was less than 25 seconds ago. Returns the seconds credited. The browser's own timer is never used.
CREATE FUNCTION learn.credit_time(p_user uuid, p_assignment uuid, p_module text, p_seconds int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE a learn.assignments; m learn.version_modules; v_day date := (now() AT TIME ZONE 'utc')::date; v_credit int; r learn.module_time;
BEGIN
  a := learn.open_assignment(p_user, p_assignment);
  m := learn.check_module_unlocked(a, p_module);
  v_credit := least(greatest(coalesce(p_seconds, 0), 0), 35);
  SELECT * INTO r FROM learn.module_time WHERE assignment_id = a.id AND module_key = p_module AND day = v_day FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO learn.module_time (assignment_id, user_id, module_key, day, seconds, last_credit_at) VALUES (a.id, p_user, p_module, v_day, 0, clock_timestamp() - interval '1 hour');
    SELECT * INTO r FROM learn.module_time WHERE assignment_id = a.id AND module_key = p_module AND day = v_day FOR UPDATE;
  END IF;
  IF clock_timestamp() - r.last_credit_at < interval '25 seconds' THEN RETURN 0; END IF;
  v_credit := least(v_credit, 14400 - r.seconds);
  IF v_credit <= 0 THEN RETURN 0; END IF;
  UPDATE learn.module_time SET seconds = seconds + v_credit, last_credit_at = clock_timestamp() WHERE assignment_id = a.id AND module_key = p_module AND day = v_day;
  RETURN v_credit;
END
$$;--> statement-breakpoint

-- Complete a module: every screen opened and the minimum active time reached.
CREATE FUNCTION learn.complete_module(p_user uuid, p_assignment uuid, p_module text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE a learn.assignments; m learn.version_modules; v_screens int; v_seconds int;
BEGIN
  a := learn.open_assignment(p_user, p_assignment);
  m := learn.check_module_unlocked(a, p_module);
  IF EXISTS (SELECT 1 FROM learn.module_completions WHERE assignment_id = a.id AND module_key = p_module) THEN RETURN; END IF;
  SELECT count(*) INTO v_screens FROM learn.module_screens WHERE assignment_id = a.id AND module_key = p_module;
  IF v_screens < m.screen_count THEN RAISE EXCEPTION 'learn:screens_missing'; END IF;
  SELECT coalesce(sum(seconds), 0) INTO v_seconds FROM learn.module_time WHERE assignment_id = a.id AND module_key = p_module;
  IF v_seconds < m.min_seconds THEN RAISE EXCEPTION 'learn:time_missing'; END IF;
  INSERT INTO learn.module_completions (assignment_id, user_id, module_key) VALUES (a.id, p_user, p_module);
END
$$;--> statement-breakpoint

-- Start (or resume) the exam. Enforces: every module done, tries left (plus HR grants), the wait after a failed try. The
-- questions are chosen here, spread across the track's modules, preferring ones the person has not seen; the option order is
-- shuffled and stored so a resumed attempt looks the same.
CREATE FUNCTION learn.start_exam(p_user uuid, p_assignment uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  a learn.assignments; cfg jsonb; v_open uuid; v_used int; v_allowed int; v_last_fail timestamptz; v_wait int;
  v_n int; v_minutes int; v_attempt uuid; v_picks uuid[];
BEGIN
  a := learn.open_assignment(p_user, p_assignment);
  SELECT exam_config INTO cfg FROM learn.course_versions WHERE id = a.version_id;
  IF EXISTS (
    SELECT 1 FROM learn.track_modules(a.version_id, a.track) t
    WHERE NOT EXISTS (SELECT 1 FROM learn.module_completions c WHERE c.assignment_id = a.id AND c.module_key = t.module_key)
  ) THEN RAISE EXCEPTION 'learn:modules_incomplete'; END IF;

  SELECT id INTO v_open FROM learn.exam_attempts WHERE assignment_id = a.id AND status = 'in_progress';
  IF FOUND THEN RETURN v_open; END IF;

  SELECT count(*) INTO v_used FROM learn.exam_attempts WHERE assignment_id = a.id AND status = 'submitted';
  v_allowed := coalesce((cfg ->> 'maxTries')::int, 3) + coalesce((SELECT sum(extra_tries) FROM learn.retry_grants WHERE assignment_id = a.id AND kind = 'tries'), 0);
  IF v_used >= v_allowed THEN RAISE EXCEPTION 'learn:no_tries_left'; END IF;

  v_wait := coalesce((cfg ->> 'waitMinutesAfterFail')::int, 60);
  SELECT max(submitted_at) INTO v_last_fail FROM learn.exam_attempts WHERE assignment_id = a.id AND status = 'submitted' AND passed IS NOT TRUE;
  IF v_last_fail IS NOT NULL AND v_last_fail + make_interval(mins => v_wait) > clock_timestamp() THEN
    RAISE EXCEPTION 'learn:wait_after_fail' USING DETAIL = to_char(v_last_fail + make_interval(mins => v_wait), 'YYYY-MM-DD"T"HH24:MI:SSOF');
  END IF;

  v_n := (cfg -> 'tracks' -> a.track ->> 'questions')::int;
  v_minutes := (cfg -> 'tracks' -> a.track ->> 'minutes')::int + coalesce((SELECT sum(extra_minutes) FROM learn.retry_grants WHERE assignment_id = a.id AND kind = 'time'), 0);
  IF v_n IS NULL OR v_minutes IS NULL THEN RAISE EXCEPTION 'learn:exam_not_configured'; END IF;

  SELECT array_agg(id ORDER BY ord) INTO v_picks FROM (
    SELECT id, row_number() OVER (ORDER BY random()) AS ord FROM (
      SELECT q.id, row_number() OVER (PARTITION BY q.module_key ORDER BY
               EXISTS (SELECT 1 FROM learn.exam_attempt_items i JOIN learn.exam_attempts x ON x.id = i.attempt_id WHERE x.assignment_id = a.id AND i.question_id = q.id),
               random()) AS rn,
             random() AS tie
      FROM learn.questions q
      JOIN learn.track_modules(a.version_id, a.track) t ON t.module_key = q.module_key
      WHERE q.version_id = a.version_id
    ) ranked
    ORDER BY rn, tie
    LIMIT v_n
  ) chosen;
  IF coalesce(cardinality(v_picks), 0) < v_n THEN RAISE EXCEPTION 'learn:bank_too_small'; END IF;

  INSERT INTO learn.exam_attempts (assignment_id, user_id, attempt_no, deadline_at, total_count)
  VALUES (a.id, p_user, v_used + 1, clock_timestamp() + make_interval(mins => v_minutes), v_n)
  RETURNING id INTO v_attempt;

  INSERT INTO learn.exam_attempt_items (attempt_id, position, question_id, option_order)
  SELECT v_attempt, (u.ord - 1)::smallint, u.qid,
         (SELECT array_agg(o ->> 'id' ORDER BY random()) FROM jsonb_array_elements(q.options) o)
  FROM unnest(v_picks) WITH ORDINALITY AS u(qid, ord) JOIN learn.questions q ON q.id = u.qid;
  RETURN v_attempt;
END
$$;--> statement-breakpoint

-- Save one answer. Refused after the deadline, for a question that is not in the attempt, or for an option that does not exist.
CREATE FUNCTION learn.save_answer(p_user uuid, p_attempt uuid, p_question uuid, p_selected text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE x learn.exam_attempts; v_order text[]; v_clean text[];
BEGIN
  SELECT * INTO x FROM learn.exam_attempts WHERE id = p_attempt AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF x.status <> 'in_progress' THEN RAISE EXCEPTION 'learn:already_submitted'; END IF;
  IF clock_timestamp() > x.deadline_at THEN RAISE EXCEPTION 'learn:time_up'; END IF;
  SELECT option_order INTO v_order FROM learn.exam_attempt_items WHERE attempt_id = p_attempt AND question_id = p_question;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_in_attempt'; END IF;
  SELECT coalesce(array_agg(DISTINCT s ORDER BY s), '{}') INTO v_clean FROM unnest(coalesce(p_selected, '{}')) s;
  IF EXISTS (SELECT 1 FROM unnest(v_clean) s WHERE s <> ALL (v_order)) THEN RAISE EXCEPTION 'learn:bad_option'; END IF;
  INSERT INTO learn.exam_answers (attempt_id, question_id, selected_ids) VALUES (p_attempt, p_question, v_clean)
  ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected_ids = EXCLUDED.selected_ids, answered_at = clock_timestamp();
END
$$;--> statement-breakpoint

-- Grade an attempt (the only place the answer key is read). Safe to call twice: a submitted attempt returns its stored result.
CREATE FUNCTION learn.grade_attempt(p_user uuid, p_attempt uuid)
RETURNS TABLE (score_percent numeric, correct_count int, total_count int, passed boolean, missed_modules text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE x learn.exam_attempts; cfg jsonb; v_pass numeric; v_correct int; v_total int; v_score numeric; v_passed boolean; v_missed text[];
BEGIN
  SELECT * INTO x FROM learn.exam_attempts WHERE id = p_attempt AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF x.status = 'in_progress' THEN
    SELECT v.exam_config INTO cfg FROM learn.assignments a JOIN learn.course_versions v ON v.id = a.version_id WHERE a.id = x.assignment_id;
    v_pass := coalesce((cfg ->> 'passPercent')::numeric, 85);
    SELECT count(*) INTO v_total FROM learn.exam_attempt_items WHERE attempt_id = x.id;
    SELECT count(*) INTO v_correct
    FROM learn.exam_attempt_items i
    JOIN learn.questions q ON q.id = i.question_id
    LEFT JOIN learn.exam_answers an ON an.attempt_id = i.attempt_id AND an.question_id = i.question_id
    WHERE i.attempt_id = x.id
      AND array(SELECT s FROM unnest(coalesce(an.selected_ids, '{}'::text[])) s ORDER BY s) = array(SELECT s FROM unnest(q.correct_ids) s ORDER BY s);
    v_score := round(100.0 * v_correct / greatest(v_total, 1), 2);
    v_passed := v_score >= v_pass;
    UPDATE learn.exam_attempts SET status = 'submitted', submitted_at = clock_timestamp(), correct_count = v_correct, score_percent = v_score, passed = v_passed WHERE id = x.id;
    IF v_passed THEN UPDATE learn.assignments SET status = 'passed', passed_at = clock_timestamp() WHERE id = x.assignment_id AND status = 'in_progress'; END IF;
  ELSE
    v_correct := x.correct_count; v_total := x.total_count; v_score := x.score_percent; v_passed := x.passed;
  END IF;
  SELECT coalesce(array_agg(DISTINCT q.module_key ORDER BY q.module_key), '{}') INTO v_missed
  FROM learn.exam_attempt_items i
  JOIN learn.questions q ON q.id = i.question_id
  LEFT JOIN learn.exam_answers an ON an.attempt_id = i.attempt_id AND an.question_id = i.question_id
  WHERE i.attempt_id = p_attempt
    AND array(SELECT s FROM unnest(coalesce(an.selected_ids, '{}'::text[])) s ORDER BY s) <> array(SELECT s FROM unnest(q.correct_ids) s ORDER BY s);
  RETURN QUERY SELECT v_score, v_correct, v_total, v_passed, v_missed;
END
$$;--> statement-breakpoint

-- What the person may see after an attempt. A PASSED attempt shows every question with the answer and the reason. A failed attempt
-- shows only which topics were missed (module and topic), never the right option or the reason.
CREATE FUNCTION learn.attempt_review(p_user uuid, p_attempt uuid)
RETURNS TABLE (item_position int, question_id uuid, module_key text, topic text, is_correct boolean, selected_ids text[], correct_ids text[], rationale text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE x learn.exam_attempts;
BEGIN
  SELECT * INTO x FROM learn.exam_attempts WHERE id = p_attempt AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF x.status <> 'submitted' THEN RAISE EXCEPTION 'learn:not_submitted'; END IF;
  RETURN QUERY
  SELECT i.position::int, i.question_id, q.module_key, q.topic,
         (array(SELECT s FROM unnest(coalesce(an.selected_ids, '{}'::text[])) s ORDER BY s) = array(SELECT s FROM unnest(q.correct_ids) s ORDER BY s)) AS is_correct,
         CASE WHEN x.passed THEN coalesce(an.selected_ids, '{}'::text[]) ELSE NULL END,
         CASE WHEN x.passed THEN q.correct_ids ELSE NULL END,
         CASE WHEN x.passed THEN q.rationale ELSE NULL END
  FROM learn.exam_attempt_items i
  JOIN learn.questions q ON q.id = i.question_id
  LEFT JOIN learn.exam_answers an ON an.attempt_id = i.attempt_id AND an.question_id = i.question_id
  WHERE i.attempt_id = p_attempt
    AND (x.passed OR array(SELECT s FROM unnest(coalesce(an.selected_ids, '{}'::text[])) s ORDER BY s) <> array(SELECT s FROM unnest(q.correct_ids) s ORDER BY s))
  ORDER BY i.position;
END
$$;--> statement-breakpoint

-- After a pass: record the attestation and issue the certificate (once). The typed name must match the person's name on record.
CREATE FUNCTION learn.accept_and_certify(p_user uuid, p_assignment uuid, p_statement_version text, p_typed_name text, p_ip text, p_methods text[])
RETURNS TABLE (certificate_id uuid, reference text, issued_on date, ends_on date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  a learn.assignments; cfg jsonb; v_legal text; v_pref text; v_typed text; v_holder text; v_ref text; v_today date; v_months int;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_try int := 0; v_id uuid;
BEGIN
  SELECT * INTO a FROM learn.assignments WHERE id = p_assignment AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF a.status <> 'passed' THEN RAISE EXCEPTION 'learn:not_passed'; END IF;
  IF NOT learn.user_is_active(p_user) THEN RAISE EXCEPTION 'learn:inactive'; END IF;

  -- Already certified: return the same certificate.
  RETURN QUERY SELECT c.id, c.reference, c.issued_on, c.ends_on FROM learn.certificates c WHERE c.assignment_id = a.id;
  IF FOUND THEN RETURN; END IF;

  v_typed := lower(regexp_replace(btrim(coalesce(p_typed_name, '')), '\s+', ' ', 'g'));
  IF char_length(v_typed) < 2 THEN RAISE EXCEPTION 'learn:name_required'; END IF;
  SELECT nullif(btrim(e.legal_first_name || ' ' || e.legal_last_name), ''), nullif(btrim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), '')
    INTO v_legal, v_pref
  FROM core.employees e WHERE e.user_id = p_user AND e.archived_at IS NULL ORDER BY e.created_at DESC LIMIT 1;
  IF v_legal IS NOT NULL AND v_typed NOT IN (lower(regexp_replace(v_legal, '\s+', ' ', 'g')), lower(regexp_replace(coalesce(v_pref, v_legal), '\s+', ' ', 'g'))) THEN
    RAISE EXCEPTION 'learn:name_mismatch';
  END IF;
  v_holder := coalesce(v_legal, btrim(regexp_replace(p_typed_name, '\s+', ' ', 'g')));

  INSERT INTO learn.attestations (assignment_id, user_id, statement_version, typed_name, ip, auth_methods)
  VALUES (a.id, p_user, p_statement_version, btrim(regexp_replace(p_typed_name, '\s+', ' ', 'g')), p_ip, coalesce(p_methods, '{}'));

  SELECT exam_config INTO cfg FROM learn.course_versions WHERE id = a.version_id;
  v_months := coalesce((cfg ->> 'renewalMonths')::int, 12);
  v_today := (now() AT TIME ZONE 'America/Phoenix')::date;

  LOOP
    v_try := v_try + 1;
    v_ref := 'HC-' || to_char(v_today, 'YYYY') || '-' || (
      SELECT string_agg(substr(v_alphabet, 1 + floor(random() * char_length(v_alphabet))::int, 1), '') FROM generate_series(1, 6)
    );
    BEGIN
      INSERT INTO learn.certificates (reference, user_id, assignment_id, version_id, track, holder_name, issued_on, ends_on)
      VALUES (v_ref, p_user, a.id, a.version_id, a.track, v_holder, v_today, (v_today + make_interval(months => v_months))::date)
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 8 THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN QUERY SELECT c.id, c.reference, c.issued_on, c.ends_on FROM learn.certificates c WHERE c.id = v_id;
END
$$;--> statement-breakpoint

-- The public check: reference AND the holder's full name must both match. Valid, expired, revoked or not found; nothing else is
-- returned. The same answer and similar work for a wrong reference and a wrong name.
CREATE FUNCTION learn.verify_certificate(p_reference text, p_name text)
RETURNS TABLE (status text, issued_on date, ends_on date, track text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE c learn.certificates; v_ok boolean;
BEGIN
  SELECT * INTO c FROM learn.certificates WHERE reference = upper(btrim(coalesce(p_reference, '')));
  v_ok := FOUND AND lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) = lower(regexp_replace(c.holder_name, '\s+', ' ', 'g'));
  IF NOT v_ok THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::date, NULL::date, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT
    CASE WHEN EXISTS (SELECT 1 FROM learn.certificate_revocations r WHERE r.certificate_id = c.id) THEN 'revoked'
         WHEN c.ends_on < (now() AT TIME ZONE 'America/Phoenix')::date THEN 'expired'
         ELSE 'valid' END,
    c.issued_on, c.ends_on, c.track;
END
$$;--> statement-breakpoint

-- ---- Sign-in handoff and sessions -------------------------------------------------------------------------------------
-- ELEVATE writes launch_tokens (its own connection). Learn consumes one: single use, 60 seconds, only for an active account.
CREATE FUNCTION learn.consume_launch_token(p_token_hash bytea)
RETURNS TABLE (user_id uuid, auth_methods text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE t learn.launch_tokens;
BEGIN
  UPDATE learn.launch_tokens SET used_at = clock_timestamp()
  WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > clock_timestamp()
  RETURNING * INTO t;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:token_invalid'; END IF;
  IF NOT learn.user_is_active(t.user_id) THEN RAISE EXCEPTION 'learn:inactive'; END IF;
  RETURN QUERY SELECT t.user_id, t.auth_methods;
END
$$;--> statement-breakpoint
CREATE FUNCTION learn.create_session(p_user uuid, p_token_hash bytea, p_methods text[], p_absolute_hours int) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE v_id uuid;
BEGIN
  IF NOT learn.user_is_active(p_user) THEN RAISE EXCEPTION 'learn:inactive'; END IF;
  INSERT INTO learn.sessions (token_hash, user_id, auth_methods, expires_at)
  VALUES (p_token_hash, p_user, coalesce(p_methods, '{}'), clock_timestamp() + make_interval(hours => least(greatest(p_absolute_hours, 1), 12)))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;--> statement-breakpoint
-- Look up a session by the hash of its cookie value; enforces the idle and absolute limits and that the account is still active.
CREATE FUNCTION learn.resolve_session(p_token_hash bytea, p_idle_minutes int)
RETURNS TABLE (user_id uuid, auth_methods text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE s learn.sessions;
BEGIN
  SELECT * INTO s FROM learn.sessions WHERE token_hash = p_token_hash AND ended_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF s.expires_at <= clock_timestamp() OR s.last_seen_at < clock_timestamp() - make_interval(mins => least(greatest(p_idle_minutes, 1), 240)) OR NOT learn.user_is_active(s.user_id) THEN
    UPDATE learn.sessions SET ended_at = clock_timestamp() WHERE id = s.id;
    RETURN;
  END IF;
  UPDATE learn.sessions SET last_seen_at = clock_timestamp() WHERE id = s.id;
  RETURN QUERY SELECT s.user_id, s.auth_methods;
END
$$;--> statement-breakpoint
CREATE FUNCTION learn.end_session(p_token_hash bytea) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
  UPDATE learn.sessions SET ended_at = clock_timestamp() WHERE token_hash = p_token_hash AND ended_at IS NULL
$$;--> statement-breakpoint

-- PostgreSQL lets everyone run a new function by default. Take that away from every function in this schema, then grant each one
-- to learn_app by name (a function added later must be granted on purpose).
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA learn FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION learn.current_user_id(), learn.track_modules(uuid, text) TO learn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION learn.open_screen(uuid, uuid, text, int), learn.credit_time(uuid, uuid, text, int), learn.complete_module(uuid, uuid, text),
  learn.start_exam(uuid, uuid), learn.save_answer(uuid, uuid, uuid, text[]), learn.grade_attempt(uuid, uuid), learn.attempt_review(uuid, uuid),
  learn.accept_and_certify(uuid, uuid, text, text, text, text[]), learn.verify_certificate(text, text), learn.consume_launch_token(bytea),
  learn.create_session(uuid, bytea, text[], int), learn.resolve_session(bytea, int), learn.end_session(bytea) TO learn_app;
