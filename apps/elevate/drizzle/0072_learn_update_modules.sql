CREATE TABLE "learn"."update_scopes" (
	"assignment_id" uuid PRIMARY KEY NOT NULL,
	"from_version_id" uuid NOT NULL,
	"module_keys" text[] NOT NULL,
	"question_count" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "update_scopes_modules_chk" CHECK (cardinality("learn"."update_scopes"."module_keys") >= 1),
	CONSTRAINT "update_scopes_questions_chk" CHECK ("learn"."update_scopes"."question_count" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "learn"."update_scopes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learn"."update_scopes" ADD CONSTRAINT "update_scopes_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."update_scopes" ADD CONSTRAINT "update_scopes_from_version_id_course_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "learn"."course_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Update modules (Release 3). A material version change gives people already certified a short assignment (reason 'update') that
-- covers only the modules whose content changed, then a few questions from them. The scope row says which. A person's modules for an
-- assignment now come from learn.assignment_modules(), which narrows the track's modules to the scope when one exists.
GRANT SELECT ON learn.update_scopes TO learn_app;--> statement-breakpoint
CREATE POLICY learn_app_read ON learn.update_scopes FOR SELECT TO learn_app USING (
  EXISTS (SELECT 1 FROM learn.assignments a WHERE a.id = assignment_id AND a.user_id = learn.current_user_id())
);--> statement-breakpoint
CREATE FUNCTION learn.assignment_modules(p_assignment uuid) RETURNS SETOF learn.version_modules LANGUAGE sql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
  SELECT m.* FROM learn.assignments a
  JOIN learn.version_modules m ON m.version_id = a.version_id AND a.track = ANY (m.tracks)
  LEFT JOIN learn.update_scopes s ON s.assignment_id = a.id
  WHERE a.id = p_assignment AND (s.assignment_id IS NULL OR m.module_key = ANY (s.module_keys))
  ORDER BY m.position
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION learn.assignment_modules(uuid) TO learn_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION learn.check_module_unlocked(a learn.assignments, p_module text) RETURNS learn.version_modules LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE m learn.version_modules;
BEGIN
  SELECT * INTO m FROM learn.assignment_modules(a.id) WHERE module_key = p_module;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:no_such_module'; END IF;
  IF EXISTS (
    SELECT 1 FROM learn.assignment_modules(a.id) t
    WHERE t.position < m.position
      AND NOT EXISTS (SELECT 1 FROM learn.module_completions c WHERE c.assignment_id = a.id AND c.module_key = t.module_key)
  ) THEN RAISE EXCEPTION 'learn:module_locked'; END IF;
  RETURN m;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION learn.start_exam(p_user uuid, p_assignment uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  a learn.assignments; cfg jsonb; v_open uuid; v_used int; v_allowed int; v_last_fail timestamptz; v_wait int;
  v_n int; v_minutes int; v_extra int; v_attempt uuid; v_picks uuid[];
BEGIN
  a := learn.open_assignment(p_user, p_assignment);
  SELECT exam_config INTO cfg FROM learn.course_versions WHERE id = a.version_id;
  IF EXISTS (
    SELECT 1 FROM learn.assignment_modules(a.id) t
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

  -- an update module has its own question count (recorded when it was assigned); everything else follows the exam rules
  SELECT s.question_count INTO v_n FROM learn.update_scopes s WHERE s.assignment_id = a.id;
  IF v_n IS NULL THEN v_n := (cfg -> 'tracks' -> a.track ->> 'questions')::int; END IF;
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
      JOIN learn.assignment_modules(a.id) t ON t.module_key = q.module_key
      WHERE q.version_id = a.version_id
    ) ranked
    ORDER BY rn, tie
    LIMIT v_n
  ) chosen;
  -- an update module draws what its changed modules have, if that is fewer than planned (never fewer than one)
  IF a.reason = 'update' AND coalesce(cardinality(v_picks), 0) BETWEEN 1 AND v_n - 1 THEN v_n := cardinality(v_picks); END IF;
  IF coalesce(cardinality(v_picks), 0) < v_n OR coalesce(cardinality(v_picks), 0) = 0 THEN RAISE EXCEPTION 'learn:bank_too_small'; END IF;

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

CREATE OR REPLACE FUNCTION learn.accept_and_certify(p_user uuid, p_assignment uuid, p_statement_version text, p_typed_name text, p_ip text, p_methods text[])
RETURNS TABLE (certificate_id uuid, reference text, issued_on date, ends_on date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE
  a learn.assignments; cfg jsonb; v_legal text; v_pref text; v_typed text; v_holder text; v_ref text; v_today date; v_months int;
  v_prefix text; v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_try int := 0; v_id uuid;
BEGIN
  SELECT * INTO a FROM learn.assignments WHERE id = p_assignment AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'learn:not_found'; END IF;
  IF a.status <> 'passed' THEN RAISE EXCEPTION 'learn:not_passed'; END IF;
  IF NOT learn.user_is_active(p_user) THEN RAISE EXCEPTION 'learn:inactive'; END IF;
  -- An update module records the person's acceptance but issues no certificate: the one they hold keeps its own dates.
  IF a.reason = 'update' AND EXISTS (SELECT 1 FROM learn.attestations t WHERE t.assignment_id = a.id) THEN RETURN; END IF;

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
  IF a.reason = 'update' THEN RETURN; END IF;

  SELECT exam_config INTO cfg FROM learn.course_versions WHERE id = a.version_id;
  v_months := coalesce((cfg ->> 'renewalMonths')::int, 12);
  v_today := (now() AT TIME ZONE 'America/Phoenix')::date;
  -- The reference starts with a short code for the course: ERSHC for HIPAA, ERSCSC for Cybersecurity basics, ERSCL for a client add-on, ERSLN for any other.
  SELECT CASE WHEN co.kind = 'client_addon' THEN 'ERSCL' ELSE CASE co.slug WHEN 'hipaa' THEN 'ERSHC' WHEN 'cybersecurity' THEN 'ERSCSC' ELSE 'ERSLN' END END INTO v_prefix
  FROM learn.course_versions cv JOIN learn.courses co ON co.id = cv.course_id WHERE cv.id = a.version_id;
  v_prefix := coalesce(v_prefix, 'ERSLN');

  LOOP
    v_try := v_try + 1;
    v_ref := v_prefix || '-' || to_char(v_today, 'YYYY') || '-' || (
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
$$;
