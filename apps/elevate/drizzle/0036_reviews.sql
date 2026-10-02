CREATE TABLE "talent"."goal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"author_user_id" uuid,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."goal_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"target_on" date,
	"status" text DEFAULT 'not_started' NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_status_chk" CHECK ("talent"."goals"."status" in ('not_started','in_progress','done','dropped'))
);
--> statement-breakpoint
ALTER TABLE "talent"."goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."review_acknowledgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"comment" text,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."review_acknowledgments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."review_calibrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"final_rating" smallint NOT NULL,
	"summary" text,
	"change_reason" text,
	"calibrated_by" uuid,
	"calibrated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_calibrations_rating_chk" CHECK ("talent"."review_calibrations"."final_rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "talent"."review_calibrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."review_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"questions" jsonb NOT NULL,
	"self_due_on" date NOT NULL,
	"lead_due_on" date NOT NULL,
	"calibrate_due_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_cycles_type_chk" CHECK ("talent"."review_cycles"."type" in ('quarterly','annual','early')),
	CONSTRAINT "review_cycles_status_chk" CHECK ("talent"."review_cycles"."status" in ('open','closed'))
);
--> statement-breakpoint
ALTER TABLE "talent"."review_cycles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."review_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"role" text NOT NULL,
	"answers" jsonb NOT NULL,
	"overall_rating" smallint,
	"comments" text,
	"author_user_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_responses_role_chk" CHECK ("talent"."review_responses"."role" in ('self','lead')),
	CONSTRAINT "review_responses_rating_chk" CHECK ("talent"."review_responses"."overall_rating" is null or "talent"."review_responses"."overall_rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "talent"."review_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."review_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"early_enabled" boolean DEFAULT true NOT NULL,
	"early_template_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_settings_one_row_chk" CHECK ("talent"."review_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "talent"."review_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."review_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"questions" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."review_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"lead_user_id" uuid,
	"milestone" smallint,
	"self_submitted_at" timestamp with time zone,
	"lead_submitted_at" timestamp with time zone,
	"calibrated_at" timestamp with time zone,
	"shared_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"last_reminder_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_milestone_chk" CHECK ("talent"."reviews"."milestone" is null or "talent"."reviews"."milestone" in (3,5))
);
--> statement-breakpoint
ALTER TABLE "talent"."reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."goal_notes" ADD CONSTRAINT "goal_notes_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "talent"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."goal_notes" ADD CONSTRAINT "goal_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."goals" ADD CONSTRAINT "goals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."goals" ADD CONSTRAINT "goals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."review_acknowledgments" ADD CONSTRAINT "review_acknowledgments_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "talent"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."review_acknowledgments" ADD CONSTRAINT "review_acknowledgments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."review_calibrations" ADD CONSTRAINT "review_calibrations_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "talent"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."review_calibrations" ADD CONSTRAINT "review_calibrations_calibrated_by_users_id_fk" FOREIGN KEY ("calibrated_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."review_cycles" ADD CONSTRAINT "review_cycles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."review_responses" ADD CONSTRAINT "review_responses_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "talent"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."review_responses" ADD CONSTRAINT "review_responses_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."review_settings" ADD CONSTRAINT "review_settings_early_template_id_review_templates_id_fk" FOREIGN KEY ("early_template_id") REFERENCES "talent"."review_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."review_templates" ADD CONSTRAINT "review_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."reviews" ADD CONSTRAINT "reviews_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "talent"."review_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."reviews" ADD CONSTRAINT "reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."reviews" ADD CONSTRAINT "reviews_lead_user_id_users_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_notes_goal_idx" ON "talent"."goal_notes" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goals_employee_idx" ON "talent"."goals" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_acknowledgments_review_idx" ON "talent"."review_acknowledgments" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_calibrations_review_idx" ON "talent"."review_calibrations" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_responses_role_idx" ON "talent"."review_responses" USING btree ("review_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "review_templates_name_idx" ON "talent"."review_templates" USING btree (lower("name")) WHERE "talent"."review_templates"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_cycle_employee_idx" ON "talent"."reviews" USING btree ("cycle_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_milestone_idx" ON "talent"."reviews" USING btree ("employee_id","milestone") WHERE "talent"."reviews"."milestone" is not null;--> statement-breakpoint
CREATE INDEX "reviews_employee_idx" ON "talent"."reviews" USING btree ("employee_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION talent.reviews_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- A review only moves forward: its identity never changes and each step, once set, stays set.
  IF NEW.cycle_id <> OLD.cycle_id OR NEW.employee_id <> OLD.employee_id OR NEW.milestone IS DISTINCT FROM OLD.milestone THEN
    RAISE EXCEPTION 'a review cannot be moved to another cycle or person';
  END IF;
  IF (OLD.self_submitted_at IS NOT NULL AND NEW.self_submitted_at IS DISTINCT FROM OLD.self_submitted_at)
     OR (OLD.lead_submitted_at IS NOT NULL AND NEW.lead_submitted_at IS DISTINCT FROM OLD.lead_submitted_at)
     OR (OLD.shared_at IS NOT NULL AND NEW.shared_at IS DISTINCT FROM OLD.shared_at)
     OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at) THEN
    RAISE EXCEPTION 'a finished review step cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reviews_guard BEFORE UPDATE ON talent.reviews FOR EACH ROW EXECUTE FUNCTION talent.reviews_guard();
--> statement-breakpoint
CREATE TRIGGER reviews_no_delete BEFORE DELETE ON talent.reviews FOR EACH ROW EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
CREATE TRIGGER review_responses_append_only BEFORE UPDATE OR DELETE ON talent.review_responses FOR EACH ROW EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
CREATE TRIGGER review_responses_no_truncate BEFORE TRUNCATE ON talent.review_responses FOR EACH STATEMENT EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
CREATE TRIGGER review_calibrations_append_only BEFORE UPDATE OR DELETE ON talent.review_calibrations FOR EACH ROW EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
CREATE TRIGGER review_calibrations_no_truncate BEFORE TRUNCATE ON talent.review_calibrations FOR EACH STATEMENT EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
CREATE TRIGGER review_acknowledgments_append_only BEFORE UPDATE OR DELETE ON talent.review_acknowledgments FOR EACH ROW EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
CREATE TRIGGER review_acknowledgments_no_truncate BEFORE TRUNCATE ON talent.review_acknowledgments FOR EACH STATEMENT EXECUTE FUNCTION talent.reject_change();
--> statement-breakpoint
INSERT INTO talent.review_settings (id) VALUES (1) ON CONFLICT DO NOTHING;