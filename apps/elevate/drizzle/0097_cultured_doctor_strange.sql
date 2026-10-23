CREATE TABLE "learn"."call_attempt_steps" (
	"attempt_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"option_id" text NOT NULL,
	"points" smallint NOT NULL,
	"mood_after" smallint NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_attempt_steps_attempt_id_scenario_id_step_id_pk" PRIMARY KEY("attempt_id","scenario_id","step_id")
);
--> statement-breakpoint
ALTER TABLE "learn"."call_attempt_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."call_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_no" smallint NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"scenario_ids" uuid[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"score_percent" numeric(5, 2),
	"passed" boolean,
	"category_scores" jsonb,
	CONSTRAINT "call_attempts_status_chk" CHECK ("learn"."call_attempts"."status" in ('in_progress','submitted')),
	CONSTRAINT "call_attempts_done_chk" CHECK (("learn"."call_attempts"."status" = 'submitted') = ("learn"."call_attempts"."submitted_at" is not null and "learn"."call_attempts"."passed" is not null))
);
--> statement-breakpoint
ALTER TABLE "learn"."call_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."call_scenario_keys" (
	"scenario_id" uuid PRIMARY KEY NOT NULL,
	"steps" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learn"."call_scenario_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "learn"."call_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"module_key" text NOT NULL,
	"medical" boolean DEFAULT false NOT NULL,
	"intro" text NOT NULL,
	"start_mood" smallint NOT NULL,
	"record" jsonb,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_scenarios_mood_chk" CHECK ("learn"."call_scenarios"."start_mood" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "learn"."call_scenarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD COLUMN "requires_call" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."call_attempt_steps" ADD CONSTRAINT "call_attempt_steps_attempt_id_call_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "learn"."call_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."call_attempt_steps" ADD CONSTRAINT "call_attempt_steps_scenario_id_call_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "learn"."call_scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."call_attempts" ADD CONSTRAINT "call_attempts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."call_attempts" ADD CONSTRAINT "call_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."call_scenario_keys" ADD CONSTRAINT "call_scenario_keys_scenario_id_call_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "learn"."call_scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."call_scenarios" ADD CONSTRAINT "call_scenarios_version_id_course_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "learn"."course_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_attempts_number_idx" ON "learn"."call_attempts" USING btree ("assignment_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "call_attempts_open_idx" ON "learn"."call_attempts" USING btree ("assignment_id") WHERE "learn"."call_attempts"."status" = 'in_progress';--> statement-breakpoint
CREATE UNIQUE INDEX "call_scenarios_key_idx" ON "learn"."call_scenarios" USING btree ("version_id","key");--> statement-breakpoint
CREATE INDEX "call_scenarios_version_idx" ON "learn"."call_scenarios" USING btree ("version_id");