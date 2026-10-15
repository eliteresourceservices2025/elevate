CREATE TABLE "learn"."drill_results" (
	"user_id" uuid NOT NULL,
	"course_slug" text NOT NULL,
	"quarter" text NOT NULL,
	"drill_key" text NOT NULL,
	"choice" text NOT NULL,
	"correct" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drill_results_user_id_course_slug_quarter_pk" PRIMARY KEY("user_id","course_slug","quarter"),
	CONSTRAINT "drill_results_quarter_chk" CHECK ("learn"."drill_results"."quarter" ~ '^[0-9]{4}-Q[1-4]$'),
	CONSTRAINT "drill_results_choice_chk" CHECK ("learn"."drill_results"."choice" in ('a','b','c'))
);
--> statement-breakpoint
ALTER TABLE "learn"."drill_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learn"."drill_results" ADD CONSTRAINT "drill_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Quarterly micro-drills: the person reads only their own answers; the answer is written by record_drill, once per quarter.
GRANT SELECT ON learn.drill_results TO learn_app;--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.drill_results FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE TRIGGER drill_results_append_only BEFORE UPDATE OR DELETE ON learn.drill_results FOR EACH ROW EXECUTE FUNCTION learn.reject_change();--> statement-breakpoint
-- Records the person's answer for the quarter (the app works out correctness from its own content). Only someone with an assignment
-- in the course (not a cancelled one) may answer; a second answer in the same quarter changes nothing. Returns true when it was recorded.
CREATE FUNCTION learn.record_drill(p_user uuid, p_course text, p_quarter text, p_key text, p_choice text, p_correct boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
DECLARE v_done int;
BEGIN
  IF NOT learn.user_is_active(p_user) THEN RAISE EXCEPTION 'learn:inactive'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM learn.assignments a JOIN learn.courses c ON c.id = a.course_id
    WHERE a.user_id = p_user AND c.slug = p_course AND a.status <> 'cancelled'
  ) THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  INSERT INTO learn.drill_results (user_id, course_slug, quarter, drill_key, choice, correct)
  VALUES (p_user, p_course, p_quarter, p_key, p_choice, p_correct)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done = 1;
END
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION learn.record_drill(uuid, text, text, text, text, boolean) TO learn_app;
