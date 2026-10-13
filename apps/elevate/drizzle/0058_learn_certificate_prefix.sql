-- Certificate references now start with a code for the course: ERSHC-YYYY-XXXXXX (HIPAA), ERSCSC-YYYY-XXXXXX (Cybersecurity basics),
-- ERSLN-YYYY-XXXXXX (any other course). The old HC- form stays valid so a certificate already issued keeps working.
ALTER TABLE "learn"."certificates" DROP CONSTRAINT "certificates_reference_chk";--> statement-breakpoint
ALTER TABLE "learn"."certificates" ADD CONSTRAINT "certificates_reference_chk" CHECK ("learn"."certificates"."reference" ~ '^(HC|ERSHC|ERSCSC|ERSLN)-[0-9]{4}-[A-Z2-9]{6}$');--> statement-breakpoint
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
  -- The reference starts with a short code for the course: ERSHC for HIPAA, ERSCSC for Cybersecurity basics, ERSLN for any other.
  SELECT CASE co.slug WHEN 'hipaa' THEN 'ERSHC' WHEN 'cybersecurity' THEN 'ERSCSC' ELSE 'ERSLN' END INTO v_prefix
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
