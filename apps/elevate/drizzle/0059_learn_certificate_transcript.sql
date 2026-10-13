-- What the certificate's transcript page shows for one assignment: the modules of the person's track with the day each was finished,
-- the passing exam's score and day, and the address recorded when the statement was accepted. SECURITY INVOKER on purpose: the Learn
-- app role reads it through row-level security, so a person gets only their own assignment's data (anything else returns null).
-- Dates are days in the company zone (America/Phoenix).
CREATE FUNCTION learn.certificate_transcript(p_assignment uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path = learn, pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'modules', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'title', m.title,
               'completedOn', (SELECT (c.completed_at AT TIME ZONE 'America/Phoenix')::date::text
                               FROM learn.module_completions c WHERE c.assignment_id = a.id AND c.module_key = m.module_key)
             ) ORDER BY m.position)
      FROM learn.track_modules(a.version_id, a.track) m), '[]'::jsonb),
    'scorePercent', (SELECT x.score_percent::float FROM learn.exam_attempts x
                     WHERE x.assignment_id = a.id AND x.passed ORDER BY x.attempt_no DESC LIMIT 1),
    'takenOn', (SELECT (x.submitted_at AT TIME ZONE 'America/Phoenix')::date::text FROM learn.exam_attempts x
                WHERE x.assignment_id = a.id AND x.passed ORDER BY x.attempt_no DESC LIMIT 1),
    'ipAddress', (SELECT t.ip FROM learn.attestations t WHERE t.assignment_id = a.id ORDER BY t.accepted_at DESC LIMIT 1)
  )
  FROM learn.assignments a WHERE a.id = p_assignment
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION learn.certificate_transcript(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION learn.certificate_transcript(uuid) TO learn_app;
