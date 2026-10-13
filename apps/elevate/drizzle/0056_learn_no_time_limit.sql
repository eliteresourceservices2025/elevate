ALTER TABLE "learn"."exam_attempts" ALTER COLUMN "deadline_at" DROP NOT NULL;--> statement-breakpoint
-- A course may set no time limit for its exam: when the exam configuration has no "minutes", the attempt has no deadline. A limit,
-- when set, still works exactly as before (answers after the deadline are refused).
CREATE OR REPLACE FUNCTION learn.start_exam(p_user uuid, p_assignment uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  a learn.assignments; cfg jsonb; v_open uuid; v_used int; v_allowed int; v_last_fail timestamptz; v_wait int;
  v_n int; v_minutes int; v_extra int; v_attempt uuid; v_picks uuid[];
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
  IF v_n IS NULL THEN RAISE EXCEPTION 'learn:exam_not_configured'; END IF;
  -- no "minutes" in the configuration = no time limit
  v_minutes := (cfg -> 'tracks' -> a.track ->> 'minutes')::int;
  v_extra := coalesce((SELECT sum(extra_minutes) FROM learn.retry_grants WHERE assignment_id = a.id AND kind = 'time'), 0);

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
  VALUES (a.id, p_user, v_used + 1,
          CASE WHEN v_minutes IS NULL THEN NULL ELSE clock_timestamp() + make_interval(mins => v_minutes + v_extra) END,
          v_n)
  RETURNING id INTO v_attempt;

  INSERT INTO learn.exam_attempt_items (attempt_id, position, question_id, option_order)
  SELECT v_attempt, (u.ord - 1)::smallint, u.qid,
         (SELECT array_agg(o ->> 'id' ORDER BY random()) FROM jsonb_array_elements(q.options) o)
  FROM unnest(v_picks) WITH ORDINALITY AS u(qid, ord) JOIN learn.questions q ON q.id = u.qid;
  RETURN v_attempt;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION learn.save_answer(p_user uuid, p_attempt uuid, p_question uuid, p_selected text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
DECLARE x learn.exam_attempts; v_order text[]; v_clean text[];
BEGIN
  SELECT * INTO x FROM learn.exam_attempts WHERE id = p_attempt AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF x.status <> 'in_progress' THEN RAISE EXCEPTION 'learn:already_submitted'; END IF;
  IF x.deadline_at IS NOT NULL AND clock_timestamp() > x.deadline_at THEN RAISE EXCEPTION 'learn:time_up'; END IF;
  SELECT option_order INTO v_order FROM learn.exam_attempt_items WHERE attempt_id = p_attempt AND question_id = p_question;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_in_attempt'; END IF;
  SELECT coalesce(array_agg(DISTINCT s ORDER BY s), '{}') INTO v_clean FROM unnest(coalesce(p_selected, '{}')) s;
  IF EXISTS (SELECT 1 FROM unnest(v_clean) s WHERE s <> ALL (v_order)) THEN RAISE EXCEPTION 'learn:bad_option'; END IF;
  INSERT INTO learn.exam_answers (attempt_id, question_id, selected_ids) VALUES (p_attempt, p_question, v_clean)
  ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected_ids = EXCLUDED.selected_ids, answered_at = clock_timestamp();
END
$$;
