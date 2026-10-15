ALTER TABLE "learn"."courses" ADD COLUMN "requires_exam" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Acknowledgment-only add-ons (Release 3): a course with requires_exam = false is finished by reading every module and accepting the
-- statement. accept_and_certify closes the assignment as passed itself, then records the acceptance and issues the certificate.
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
  IF a.status <> 'passed' THEN
    -- A course with no exam (acknowledgment only) is finished by reading every module and accepting the statement.
    IF a.status IN ('assigned', 'in_progress')
       AND NOT (SELECT co.requires_exam FROM learn.courses co WHERE co.id = a.course_id)
       AND NOT EXISTS (
         SELECT 1 FROM learn.assignment_modules(a.id) m
         WHERE NOT EXISTS (SELECT 1 FROM learn.module_completions c WHERE c.assignment_id = a.id AND c.module_key = m.module_key)
       )
    THEN
      IF a.status = 'assigned' THEN UPDATE learn.assignments SET status = 'in_progress' WHERE id = a.id; END IF;
      UPDATE learn.assignments SET status = 'passed', passed_at = clock_timestamp() WHERE id = a.id;
      a.status := 'passed';
    ELSE
      RAISE EXCEPTION 'learn:not_passed';
    END IF;
  END IF;
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
