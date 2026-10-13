CREATE TABLE "learn"."assignment_rules" (
	"course_id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"team_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_rules_mode_chk" CHECK ("learn"."assignment_rules"."mode" in ('all','teams','paused')),
	CONSTRAINT "assignment_rules_teams_chk" CHECK ("learn"."assignment_rules"."mode" <> 'teams' or cardinality("learn"."assignment_rules"."team_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "learn"."assignment_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learn"."assignment_rules" ADD CONSTRAINT "assignment_rules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignment_rules" ADD CONSTRAINT "assignment_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Only ELEVATE reads and writes this table; the Learn app role must have no access to it.
REVOKE ALL ON TABLE learn.assignment_rules FROM PUBLIC;
