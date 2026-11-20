-- Review fixes for client guests: a guest never becomes a staff people record, and never holds a staff-only flag.
CREATE FUNCTION core.employee_guest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM core.users u WHERE u.id = NEW.user_id AND u.is_guest) THEN
    RAISE EXCEPTION 'A guest account cannot be linked to a people record';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER employee_guest_guard BEFORE INSERT OR UPDATE OF user_id ON core.employees
  FOR EACH ROW EXECUTE FUNCTION core.employee_guest_guard();
--> statement-breakpoint
ALTER TABLE core.users ADD CONSTRAINT users_guest_flags_chk
  CHECK (NOT is_guest OR (payroll_access IS NULL AND NOT is_privacy_officer AND NOT is_safevoice_handler));
