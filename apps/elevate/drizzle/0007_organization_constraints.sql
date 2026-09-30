-- Foreign keys from employees to the organization tables (kept out of the schema files so the
-- people and org schema modules do not import each other).
ALTER TABLE core.employees
  ADD CONSTRAINT employees_team_id_teams_id_fk FOREIGN KEY (team_id) REFERENCES core.teams (id);
--> statement-breakpoint
ALTER TABLE core.employees
  ADD CONSTRAINT employees_position_id_positions_id_fk FOREIGN KEY (position_id) REFERENCES core.positions (id);
--> statement-breakpoint

-- Positions become a catalog. Turn the free-text positions people already have into catalog rows
-- and link them; employees.position stays as the display title.
INSERT INTO core.positions (title)
SELECT DISTINCT ON (lower(btrim(position))) btrim(position)
FROM core.employees
WHERE position IS NOT NULL AND btrim(position) <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE core.employees e
SET position_id = p.id, position = p.title
FROM core.positions p
WHERE e.position IS NOT NULL AND lower(btrim(e.position)) = lower(p.title);
--> statement-breakpoint

-- Reporting lines can never form a loop: nobody is their own boss, directly or through a chain.
-- The advisory lock serializes manager changes, so two people changing two managers at the same
-- moment cannot each pass the check and together create a cycle.
CREATE OR REPLACE FUNCTION core.prevent_manager_cycle() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.manager_id = NEW.id THEN
    RAISE EXCEPTION 'manager_cycle: a person cannot report to themselves' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('core.employees.manager_chain'));

  IF EXISTS (
    WITH RECURSIVE up(id, manager_id, depth) AS (
      SELECT e.id, e.manager_id, 1 FROM core.employees e WHERE e.id = NEW.manager_id
      UNION ALL
      SELECT e.id, e.manager_id, up.depth + 1
      FROM core.employees e JOIN up ON e.id = up.manager_id
      WHERE up.depth < 200
    )
    SELECT 1 FROM up WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'manager_cycle: that would make the reporting line a loop' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER employees_prevent_manager_cycle
  BEFORE INSERT OR UPDATE OF manager_id ON core.employees
  FOR EACH ROW EXECUTE FUNCTION core.prevent_manager_cycle();
