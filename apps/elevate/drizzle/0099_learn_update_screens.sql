ALTER TABLE "learn"."update_scopes" ADD COLUMN "screens" jsonb;--> statement-breakpoint
-- Update modules, by screen (Release 4). An update used to make a person re-read every changed module whole. Now the scope also names the
-- screens that are NEW or CHANGED in each module (update_scopes.screens, { "<module key>": [screen index, ...] }), and the person learns
-- only those. Rows written before this have no screens and still mean whole modules. Finishing a scoped module needs only those screens
-- opened and a share of the reading time in proportion to how many screens they are.
CREATE FUNCTION learn.update_screen_indexes(p_assignment uuid, p_module text) RETURNS int[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
  SELECT (SELECT array_agg(x::int ORDER BY x::int) FROM jsonb_array_elements_text(s.screens -> p_module) x)
  FROM learn.update_scopes s WHERE s.assignment_id = p_assignment AND s.screens IS NOT NULL AND s.screens ? p_module
$$;--> statement-breakpoint
CREATE FUNCTION learn.assignment_min_seconds(p_assignment uuid, p_module text) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
  SELECT CASE
           WHEN idx IS NULL OR m.screen_count < 1 THEN m.min_seconds
           ELSE least(m.min_seconds, ceil(m.min_seconds::numeric * cardinality(idx) / m.screen_count)::int)
         END
  FROM learn.assignments a
  JOIN learn.version_modules m ON m.version_id = a.version_id AND m.module_key = p_module
  CROSS JOIN LATERAL (SELECT learn.update_screen_indexes(a.id, p_module) AS idx) x
  WHERE a.id = p_assignment
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION learn.update_screen_indexes(uuid, text), learn.assignment_min_seconds(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION learn.update_screen_indexes(uuid, text), learn.assignment_min_seconds(uuid, text) TO learn_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION learn.complete_module(p_user uuid, p_assignment uuid, p_module text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE a learn.assignments; m learn.version_modules; v_screens int; v_seconds int; v_idx int[]; v_min int;
BEGIN
  a := learn.open_assignment(p_user, p_assignment);
  m := learn.check_module_unlocked(a, p_module);
  IF EXISTS (SELECT 1 FROM learn.module_completions WHERE assignment_id = a.id AND module_key = p_module) THEN RETURN; END IF;
  v_idx := learn.update_screen_indexes(a.id, p_module);
  IF v_idx IS NULL THEN
    SELECT count(*) INTO v_screens FROM learn.module_screens WHERE assignment_id = a.id AND module_key = p_module;
    IF v_screens < m.screen_count THEN RAISE EXCEPTION 'learn:screens_missing'; END IF;
  ELSE
    SELECT count(*) INTO v_screens FROM learn.module_screens WHERE assignment_id = a.id AND module_key = p_module AND screen_index = ANY (v_idx);
    IF v_screens < cardinality(v_idx) THEN RAISE EXCEPTION 'learn:screens_missing'; END IF;
  END IF;
  v_min := learn.assignment_min_seconds(a.id, p_module);
  SELECT coalesce(sum(seconds), 0) INTO v_seconds FROM learn.module_time WHERE assignment_id = a.id AND module_key = p_module;
  IF v_seconds < v_min THEN RAISE EXCEPTION 'learn:time_missing'; END IF;
  INSERT INTO learn.module_completions (assignment_id, user_id, module_key) VALUES (a.id, p_user, p_module);
END
$$;
