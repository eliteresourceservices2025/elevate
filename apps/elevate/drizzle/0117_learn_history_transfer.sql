-- Moving training history from one account to the account a person now uses (a duplicate-profile merge, or a reviewed repair of an
-- orphaned account). The records stay append-only for everyone else: the guards below allow exactly one change, a different user_id with
-- every other column identical, and only while learn.transfer_history() is running in the same transaction (a transaction-local
-- setting that only that function sets). learn_app has no write grants on these tables and no right to run the function, so the app
-- role cannot use this. Each transfer is recorded in learn.history_transfers.
CREATE FUNCTION learn.history_transfer_ok(p_old jsonb, p_new jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('learn.history_transfer', true), '') = 'on'
     AND (p_new ->> 'user_id') IS DISTINCT FROM (p_old ->> 'user_id')
     AND (p_new - 'user_id') = (p_old - 'user_id')
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION learn.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND learn.history_transfer_ok(to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'learn: % on learn.% is not allowed (training records are append-only)', TG_OP, TG_TABLE_NAME;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION learn.assignments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: assignments are never deleted'; END IF;
  IF learn.history_transfer_ok(to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF (NEW.id, NEW.user_id, NEW.course_id, NEW.version_id, NEW.track, NEW.reason, NEW.assigned_at, NEW.created_by)
     IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.course_id, OLD.version_id, OLD.track, OLD.reason, OLD.assigned_at, OLD.created_by) THEN
    RAISE EXCEPTION 'learn: an assignment cannot be rewritten';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'assigned' AND NEW.status IN ('in_progress', 'cancelled', 'expired'))
    OR (OLD.status = 'in_progress' AND NEW.status IN ('passed', 'cancelled', 'expired'))
    OR (OLD.status = 'passed' AND NEW.status = 'expired')
  ) THEN
    RAISE EXCEPTION 'learn: assignment status cannot go from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION learn.exam_attempts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: exam attempts are never deleted'; END IF;
  IF learn.history_transfer_ok(to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'learn: a submitted exam attempt cannot change'; END IF;
  IF (NEW.id, NEW.assignment_id, NEW.user_id, NEW.attempt_no, NEW.started_at, NEW.deadline_at, NEW.total_count)
     IS DISTINCT FROM (OLD.id, OLD.assignment_id, OLD.user_id, OLD.attempt_no, OLD.started_at, OLD.deadline_at, OLD.total_count) THEN
    RAISE EXCEPTION 'learn: an exam attempt cannot be rewritten';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION learn.module_time_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: training time cannot be deleted'; END IF;
  IF learn.history_transfer_ok(to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF (NEW.assignment_id, NEW.user_id, NEW.module_key, NEW.day) IS DISTINCT FROM (OLD.assignment_id, OLD.user_id, OLD.module_key, OLD.day) OR NEW.seconds < OLD.seconds THEN
    RAISE EXCEPTION 'learn: training time can only grow';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION learn.call_attempts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'learn: call attempts are never deleted'; END IF;
  IF learn.history_transfer_ok(to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'learn: a submitted call attempt cannot change'; END IF;
  IF (NEW.id, NEW.assignment_id, NEW.user_id, NEW.attempt_no, NEW.started_at, NEW.scenario_ids)
     IS DISTINCT FROM (OLD.id, OLD.assignment_id, OLD.user_id, OLD.attempt_no, OLD.started_at, OLD.scenario_ids) THEN
    RAISE EXCEPTION 'learn: a call attempt cannot be rewritten';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- Every transfer, kept for good.
CREATE TABLE learn.history_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES core.users (id),
  to_user_id uuid NOT NULL REFERENCES core.users (id),
  actor_id uuid NOT NULL REFERENCES core.users (id),
  reason text NOT NULL,
  assignments_moved int NOT NULL,
  assignments_skipped int NOT NULL,
  certificates_moved int NOT NULL,
  transferred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT history_transfers_reason_chk CHECK (char_length(reason) BETWEEN 3 AND 500),
  CONSTRAINT history_transfers_users_chk CHECK (from_user_id <> to_user_id)
);--> statement-breakpoint
ALTER TABLE learn.history_transfers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER history_transfers_append_only BEFORE UPDATE OR DELETE ON learn.history_transfers FOR EACH ROW EXECUTE FUNCTION learn.reject_change();--> statement-breakpoint

-- Assignment-based history follows the person. An open assignment for a course the target already has open stays where it is (choosing
-- which attempt wins is a person's decision). Quarterly practice answers (drill_results) belong to no assignment and are left alone.
CREATE FUNCTION learn.transfer_history(p_from uuid, p_to uuid, p_actor uuid, p_reason text)
RETURNS TABLE (assignments_moved int, assignments_skipped int, certificates_moved int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = learn, pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE v_moved int; v_skipped int; v_certs int; v_table text;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RAISE EXCEPTION 'learn: choose two different accounts'; END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'learn: a reason is required'; END IF;
  PERFORM 1 FROM core.users WHERE id IN (p_from, p_to) ORDER BY id FOR UPDATE;

  SELECT count(*)::int INTO v_skipped FROM learn.assignments s
  WHERE s.user_id = p_from AND s.status IN ('assigned', 'in_progress')
    AND EXISTS (SELECT 1 FROM learn.assignments t WHERE t.user_id = p_to AND t.course_id = s.course_id AND t.status IN ('assigned', 'in_progress'));

  PERFORM set_config('learn.history_transfer', 'on', true);
  UPDATE learn.assignments s SET user_id = p_to
  WHERE s.user_id = p_from
    AND NOT (s.status IN ('assigned', 'in_progress')
             AND EXISTS (SELECT 1 FROM learn.assignments t WHERE t.user_id = p_to AND t.course_id = s.course_id AND t.status IN ('assigned', 'in_progress')));
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  FOREACH v_table IN ARRAY ARRAY['module_screens', 'module_time', 'module_completions', 'retry_grants', 'exam_attempts', 'attestations', 'call_attempts'] LOOP
    EXECUTE format('UPDATE learn.%I c SET user_id = $1 FROM learn.assignments a WHERE c.assignment_id = a.id AND a.user_id = $1 AND c.user_id = $2', v_table) USING p_to, p_from;
  END LOOP;
  UPDATE learn.certificates c SET user_id = p_to FROM learn.assignments a WHERE c.assignment_id = a.id AND a.user_id = p_to AND c.user_id = p_from;
  GET DIAGNOSTICS v_certs = ROW_COUNT;
  PERFORM set_config('learn.history_transfer', 'off', true);

  INSERT INTO learn.history_transfers (from_user_id, to_user_id, actor_id, reason, assignments_moved, assignments_skipped, certificates_moved)
  VALUES (p_from, p_to, p_actor, btrim(p_reason), v_moved, v_skipped, v_certs);
  RETURN QUERY SELECT v_moved, v_skipped, v_certs;
END
$$;--> statement-breakpoint
-- Only the owner (ELEVATE's own connection) may run the transfer. The check function only reads a setting, so the triggers stay callable.
REVOKE ALL ON FUNCTION learn.transfer_history(uuid, uuid, uuid, text) FROM PUBLIC;
