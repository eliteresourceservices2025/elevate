-- The graded mock call (docs/learn/14-mock-call.md). Built like the exam: the app role reads the scenario text and its own attempts,
-- never the scoring key, and everything that scores or records runs in these definer functions. Errors are 'learn:<code>'.

-- ---- What the app role may read ---------------------------------------------------------------------------------------
GRANT SELECT ON learn.call_attempts TO learn_app;--> statement-breakpoint
-- What was picked and the mood after it, but NOT the points a pick earned (that would show the key by elimination).
GRANT SELECT (attempt_id, scenario_id, step_id, option_id, mood_after, answered_at) ON learn.call_attempt_steps TO learn_app;--> statement-breakpoint
-- The scenario text only. call_scenario_keys has no grant at all.
GRANT SELECT (id, version_id, key, title, module_key, medical, intro, start_mood, record, steps) ON learn.call_scenarios TO learn_app;--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.call_attempts FOR SELECT TO learn_app USING (user_id = learn.current_user_id());--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.call_attempt_steps FOR SELECT TO learn_app USING (
  EXISTS (SELECT 1 FROM learn.call_attempts x WHERE x.id = call_attempt_steps.attempt_id AND x.user_id = learn.current_user_id())
);--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.call_scenarios FOR SELECT TO learn_app USING (
  EXISTS (SELECT 1 FROM learn.call_attempts x WHERE x.user_id = learn.current_user_id() AND call_scenarios.id = ANY (x.scenario_ids))
);--> statement-breakpoint

-- ---- Guards -----------------------------------------------------------------------------------------------------------
CREATE FUNCTION learn.call_attempts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: call attempts are never deleted'; END IF;
  IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'learn: a submitted call attempt cannot change'; END IF;
  IF (NEW.id, NEW.assignment_id, NEW.user_id, NEW.attempt_no, NEW.started_at, NEW.scenario_ids)
     IS DISTINCT FROM (OLD.id, OLD.assignment_id, OLD.user_id, OLD.attempt_no, OLD.started_at, OLD.scenario_ids) THEN
    RAISE EXCEPTION 'learn: a call attempt cannot be rewritten';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER call_attempts_guard BEFORE UPDATE OR DELETE ON learn.call_attempts FOR EACH ROW EXECUTE FUNCTION learn.call_attempts_guard();--> statement-breakpoint

-- A pick is final. The only deletion allowed is the retention job's (it sets learn.purge for its own transaction).
CREATE FUNCTION learn.call_attempt_steps_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('learn.purge', true), '') = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'learn: % on learn.call_attempt_steps is not allowed (training records are append-only)', TG_OP;
END
$$;--> statement-breakpoint
CREATE TRIGGER call_attempt_steps_guard BEFORE UPDATE OR DELETE ON learn.call_attempt_steps FOR EACH ROW EXECUTE FUNCTION learn.call_attempt_steps_guard();--> statement-breakpoint

-- A published version is frozen: its calls and their keys change only while it is a draft (the same guard as questions).
CREATE TRIGGER call_scenarios_guard BEFORE INSERT OR UPDATE OR DELETE ON learn.call_scenarios FOR EACH ROW EXECUTE FUNCTION learn.version_children_guard();--> statement-breakpoint
CREATE FUNCTION learn.call_scenario_keys_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT cv.status INTO v_status FROM learn.call_scenarios s JOIN learn.course_versions cv ON cv.id = s.version_id WHERE s.id = coalesce(NEW.scenario_id, OLD.scenario_id);
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'learn: the calls of a published version are frozen'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER call_scenario_keys_guard BEFORE INSERT OR UPDATE OR DELETE ON learn.call_scenario_keys FOR EACH ROW EXECUTE FUNCTION learn.call_scenario_keys_guard();--> statement-breakpoint

-- ---- The one place an assignment becomes "passed" ----------------------------------------------------------------------
-- The exam must be passed and, when the course requires a call (and this is not an update module), the call too. Internal: not
-- granted to the app role.
CREATE FUNCTION learn.finish_if_complete(p_assignment uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE a learn.assignments; v_requires boolean;
BEGIN
  SELECT * INTO a FROM learn.assignments WHERE id = p_assignment FOR UPDATE;
  IF NOT FOUND OR a.status <> 'in_progress' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM learn.exam_attempts WHERE assignment_id = a.id AND passed IS TRUE) THEN RETURN; END IF;
  SELECT requires_call INTO v_requires FROM learn.courses WHERE id = a.course_id;
  IF v_requires AND a.reason <> 'update' AND NOT EXISTS (SELECT 1 FROM learn.call_attempts WHERE assignment_id = a.id AND passed IS TRUE) THEN RETURN; END IF;
  UPDATE learn.assignments SET status = 'passed', passed_at = clock_timestamp() WHERE id = a.id;
END
$$;--> statement-breakpoint

-- grade_attempt is unchanged except that passing the exam asks finish_if_complete instead of setting the status itself.
CREATE OR REPLACE FUNCTION learn.grade_attempt(p_user uuid, p_attempt uuid)
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
    IF v_passed THEN PERFORM learn.finish_if_complete(x.assignment_id); END IF;
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

-- ---- start_call -------------------------------------------------------------------------------------------------------
CREATE FUNCTION learn.start_call(p_user uuid, p_assignment uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  a learn.assignments; ccfg jsonb; v_open uuid; v_used int; v_allowed int; v_last_fail timestamptz; v_wait int; v_n int;
  v_picks uuid[]; v_med uuid; v_attempt uuid;
BEGIN
  a := learn.open_assignment(p_user, p_assignment);
  SELECT exam_config -> 'call' INTO ccfg FROM learn.course_versions WHERE id = a.version_id;
  IF ccfg IS NULL THEN RAISE EXCEPTION 'learn:calls_not_configured'; END IF;
  IF EXISTS (
    SELECT 1 FROM learn.assignment_modules(a.id) t
    WHERE NOT EXISTS (SELECT 1 FROM learn.module_completions c WHERE c.assignment_id = a.id AND c.module_key = t.module_key)
  ) THEN RAISE EXCEPTION 'learn:modules_incomplete'; END IF;

  SELECT id INTO v_open FROM learn.call_attempts WHERE assignment_id = a.id AND status = 'in_progress';
  IF FOUND THEN RETURN v_open; END IF;

  SELECT count(*) INTO v_used FROM learn.call_attempts WHERE assignment_id = a.id AND status = 'submitted';
  v_allowed := coalesce((ccfg ->> 'maxTries')::int, 3) + coalesce((SELECT sum(extra_tries) FROM learn.retry_grants WHERE assignment_id = a.id AND kind = 'tries'), 0);
  IF v_used >= v_allowed THEN RAISE EXCEPTION 'learn:no_tries_left'; END IF;

  v_wait := coalesce((ccfg ->> 'waitMinutesAfterFail')::int, 60);
  SELECT max(submitted_at) INTO v_last_fail FROM learn.call_attempts WHERE assignment_id = a.id AND status = 'submitted' AND passed IS NOT TRUE;
  IF v_last_fail IS NOT NULL AND v_last_fail + make_interval(mins => v_wait) > clock_timestamp() THEN
    RAISE EXCEPTION 'learn:wait_after_fail' USING DETAIL = to_char(v_last_fail + make_interval(mins => v_wait), 'YYYY-MM-DD"T"HH24:MI:SSOF');
  END IF;

  v_n := coalesce((ccfg ->> 'scenarios')::int, 3);
  -- calls this person has not had yet come first, then at random
  SELECT array_agg(id) INTO v_picks FROM (
    SELECT s.id FROM learn.call_scenarios s WHERE s.version_id = a.version_id
    ORDER BY EXISTS (SELECT 1 FROM learn.call_attempts x WHERE x.assignment_id = a.id AND s.id = ANY (x.scenario_ids)), random()
    LIMIT v_n
  ) t;
  IF coalesce(cardinality(v_picks), 0) < v_n THEN RAISE EXCEPTION 'learn:bank_too_small'; END IF;
  -- at least one medical call: swap the last pick for one if the draw has none
  IF NOT EXISTS (SELECT 1 FROM learn.call_scenarios WHERE id = ANY (v_picks) AND medical) THEN
    SELECT s.id INTO v_med FROM learn.call_scenarios s WHERE s.version_id = a.version_id AND s.medical
    ORDER BY EXISTS (SELECT 1 FROM learn.call_attempts x WHERE x.assignment_id = a.id AND s.id = ANY (x.scenario_ids)), random() LIMIT 1;
    IF v_med IS NULL THEN RAISE EXCEPTION 'learn:bank_too_small'; END IF;
    v_picks[v_n] := v_med;
  END IF;
  SELECT array_agg(u ORDER BY random()) INTO v_picks FROM unnest(v_picks) u;

  INSERT INTO learn.call_attempts (assignment_id, user_id, attempt_no, scenario_ids) VALUES (a.id, p_user, v_used + 1, v_picks) RETURNING id INTO v_attempt;
  RETURN v_attempt;
END
$$;--> statement-breakpoint

-- ---- answer_call_step -------------------------------------------------------------------------------------------------
-- Records one pick. Returns only what the caller says next, the new mood and whether the call / the attempt is finished: never points.
CREATE FUNCTION learn.answer_call_step(p_user uuid, p_attempt uuid, p_scenario uuid, p_step text, p_option text)
RETURNS TABLE (reply text, mood int, call_done boolean, attempt_done boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  x learn.call_attempts; k learn.call_scenario_keys; v_cur uuid; v_pos int; v_answered int; v_total int; v_step jsonb; v_choice jsonb;
  v_prev int; v_start int; v_mood int; v_done boolean;
BEGIN
  SELECT * INTO x FROM learn.call_attempts WHERE id = p_attempt AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF x.status <> 'in_progress' THEN RAISE EXCEPTION 'learn:already_submitted'; END IF;

  -- the call being played: the first one, in order, that still has an unanswered step
  SELECT u.id, u.pos::int INTO v_cur, v_pos
  FROM unnest(x.scenario_ids) WITH ORDINALITY AS u(id, pos)
  JOIN learn.call_scenario_keys kk ON kk.scenario_id = u.id
  WHERE (SELECT count(*) FROM learn.call_attempt_steps s WHERE s.attempt_id = x.id AND s.scenario_id = u.id) < jsonb_array_length(kk.steps)
  ORDER BY u.pos LIMIT 1;
  IF v_cur IS NULL OR v_cur IS DISTINCT FROM p_scenario THEN RAISE EXCEPTION 'learn:step_out_of_order'; END IF;

  SELECT * INTO k FROM learn.call_scenario_keys WHERE scenario_id = v_cur;
  SELECT start_mood INTO v_start FROM learn.call_scenarios WHERE id = v_cur;
  v_total := jsonb_array_length(k.steps);
  SELECT count(*) INTO v_answered FROM learn.call_attempt_steps WHERE attempt_id = x.id AND scenario_id = v_cur;
  v_step := k.steps -> v_answered;
  IF v_step ->> 'id' IS DISTINCT FROM p_step THEN RAISE EXCEPTION 'learn:step_out_of_order'; END IF;

  SELECT c INTO v_choice FROM jsonb_array_elements(v_step -> 'choices') c WHERE c ->> 'id' = p_option;
  IF v_choice IS NULL THEN RAISE EXCEPTION 'learn:bad_option'; END IF;

  SELECT mood_after INTO v_prev FROM learn.call_attempt_steps WHERE attempt_id = x.id AND scenario_id = v_cur ORDER BY answered_at DESC, step_id DESC LIMIT 1;
  v_mood := greatest(0, least(100, coalesce(v_prev, v_start) + (v_choice ->> 'mood')::int));
  -- clock_timestamp(), not the transaction's now(): the previous mood is found by time, so two picks must never tie
  INSERT INTO learn.call_attempt_steps (attempt_id, scenario_id, step_id, option_id, points, mood_after, answered_at)
  VALUES (x.id, v_cur, p_step, p_option, (v_choice ->> 'points')::smallint, v_mood, clock_timestamp());

  v_done := v_answered + 1 = v_total;
  RETURN QUERY SELECT v_choice ->> 'reply', v_mood, v_done, v_done AND v_pos = cardinality(x.scenario_ids);
END
$$;--> statement-breakpoint

-- ---- grade_call -------------------------------------------------------------------------------------------------------
CREATE FUNCTION learn.grade_call(p_user uuid, p_attempt uuid)
RETURNS TABLE (score_percent numeric, passed boolean, categories jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE x learn.call_attempts; ccfg jsonb; v_pass numeric; v_earned numeric; v_possible numeric; v_score numeric; v_passed boolean; v_cats jsonb;
BEGIN
  SELECT * INTO x FROM learn.call_attempts WHERE id = p_attempt AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF x.status = 'in_progress' THEN
    -- every step of every call must have been answered
    IF (SELECT coalesce(sum(jsonb_array_length(k.steps)), 0) FROM learn.call_scenario_keys k WHERE k.scenario_id = ANY (x.scenario_ids))
       <> (SELECT count(*) FROM learn.call_attempt_steps WHERE attempt_id = x.id) THEN
      RAISE EXCEPTION 'learn:call_unfinished';
    END IF;
    SELECT v.exam_config -> 'call' INTO ccfg FROM learn.assignments a JOIN learn.course_versions v ON v.id = a.version_id WHERE a.id = x.assignment_id;
    v_pass := coalesce((ccfg ->> 'passPercent')::numeric, 85);

    -- points earned and possible, in total and per category (one statement: no temporary tables, so it is safe behind the pooler)
    WITH w AS (
      SELECT st.value ->> 'category' AS category,
             (SELECT coalesce(s.points, 0) FROM learn.call_attempt_steps s WHERE s.attempt_id = x.id AND s.scenario_id = k.scenario_id AND s.step_id = st.value ->> 'id') AS earned,
             (SELECT max((c ->> 'points')::int) FROM jsonb_array_elements(st.value -> 'choices') c) AS possible
      FROM learn.call_scenario_keys k CROSS JOIN LATERAL jsonb_array_elements(k.steps) AS st(value)
      WHERE k.scenario_id = ANY (x.scenario_ids)
    ), g AS (SELECT category, sum(earned) AS e, sum(possible) AS p FROM w GROUP BY category)
    SELECT (SELECT sum(e) FROM g), (SELECT sum(p) FROM g), (SELECT jsonb_object_agg(category, round(100.0 * e / greatest(p, 1))) FROM g)
    INTO v_earned, v_possible, v_cats;

    v_score := round(100.0 * v_earned / greatest(v_possible, 1), 2);
    v_passed := v_score >= v_pass;
    UPDATE learn.call_attempts SET status = 'submitted', submitted_at = clock_timestamp(), score_percent = v_score, passed = v_passed, category_scores = v_cats WHERE id = x.id;
    IF v_passed THEN PERFORM learn.finish_if_complete(x.assignment_id); END IF;
  ELSE
    v_score := x.score_percent; v_passed := x.passed; v_cats := x.category_scores;
  END IF;
  RETURN QUERY SELECT v_score, v_passed, v_cats;
END
$$;--> statement-breakpoint

-- ---- call_review ------------------------------------------------------------------------------------------------------
-- After a PASSED attempt: every step with what was picked, the best reply and the reason. After a failed one: nothing (the category
-- percentages are on the attempt itself).
CREATE FUNCTION learn.call_review(p_user uuid, p_attempt uuid)
RETURNS TABLE (scenario_id uuid, step_id text, chosen text, best text, points int, max_points int, why text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE x learn.call_attempts;
BEGIN
  SELECT * INTO x FROM learn.call_attempts WHERE id = p_attempt AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF x.status <> 'submitted' OR x.passed IS NOT TRUE THEN RETURN; END IF;
  RETURN QUERY
  SELECT sc.id, st.value ->> 'id', ans.option_id,
         (SELECT c ->> 'id' FROM jsonb_array_elements(st.value -> 'choices') c ORDER BY (c ->> 'points')::int DESC LIMIT 1),
         ans.points::int,
         (SELECT max((c ->> 'points')::int) FROM jsonb_array_elements(st.value -> 'choices') c),
         (SELECT c ->> 'why' FROM jsonb_array_elements(st.value -> 'choices') c ORDER BY (c ->> 'points')::int DESC LIMIT 1)
  FROM unnest(x.scenario_ids) WITH ORDINALITY AS sc(id, pos)
  JOIN learn.call_scenario_keys k ON k.scenario_id = sc.id
  CROSS JOIN LATERAL jsonb_array_elements(k.steps) WITH ORDINALITY AS st(value, ord)
  JOIN learn.call_attempt_steps ans ON ans.attempt_id = x.id AND ans.scenario_id = sc.id AND ans.step_id = st.value ->> 'id'
  ORDER BY sc.pos, st.ord;
END
$$;--> statement-breakpoint

-- ---- Who may run what -------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION learn.finish_if_complete(uuid), learn.start_call(uuid, uuid), learn.answer_call_step(uuid, uuid, uuid, text, text),
  learn.grade_call(uuid, uuid), learn.call_review(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION learn.start_call(uuid, uuid), learn.answer_call_step(uuid, uuid, uuid, text, text),
  learn.grade_call(uuid, uuid), learn.call_review(uuid, uuid) TO learn_app;
