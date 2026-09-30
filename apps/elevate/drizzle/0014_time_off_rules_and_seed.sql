-- The leave ledger is evidence, like the audit log: nobody can edit or remove a row, even with direct
-- database access as the owner role. A correction is a new adjustment row.
CREATE OR REPLACE FUNCTION time.reject_leave_ledger_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'time.leave_ledger is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER leave_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON time.leave_ledger
  FOR EACH ROW EXECUTE FUNCTION time.reject_leave_ledger_change();
--> statement-breakpoint
CREATE TRIGGER leave_ledger_no_truncate
  BEFORE TRUNCATE ON time.leave_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION time.reject_leave_ledger_change();
--> statement-breakpoint
-- Two leave types to start. HR can add more in the app.
INSERT INTO time.leave_types (slug, name, tracks_balance, skip_hr) VALUES
  ('prize_day', 'Prize day off', true, false),
  ('unpaid_day', 'Unpaid day off', false, false)
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
-- Holiday calendars for 2026 and 2027. US federal dates are fixed by law and marked verified. The Philippine dates
-- come from the standing holiday laws and the usual Holy Week and Heroes Day rules, but the government proclaims
-- each year's list (and moving dates such as Eid'l Fitr) separately, so they start UNVERIFIED: HR checks them against
-- the official proclamation and ticks "verified", and adds any that are missing.
INSERT INTO time.holidays (calendar, date, name, kind, verified) VALUES
  ('US', '2026-01-01', 'New Year''s Day', 'federal', true),
  ('US', '2026-01-19', 'Martin Luther King Jr. Day', 'federal', true),
  ('US', '2026-02-16', 'Presidents'' Day', 'federal', true),
  ('US', '2026-05-25', 'Memorial Day', 'federal', true),
  ('US', '2026-06-19', 'Juneteenth', 'federal', true),
  ('US', '2026-07-03', 'Independence Day (observed)', 'observed', true),
  ('US', '2026-07-04', 'Independence Day', 'federal', true),
  ('US', '2026-09-07', 'Labor Day', 'federal', true),
  ('US', '2026-10-12', 'Columbus Day', 'federal', true),
  ('US', '2026-11-11', 'Veterans Day', 'federal', true),
  ('US', '2026-11-26', 'Thanksgiving Day', 'federal', true),
  ('US', '2026-12-25', 'Christmas Day', 'federal', true),
  ('US', '2027-01-01', 'New Year''s Day', 'federal', true),
  ('US', '2027-01-18', 'Martin Luther King Jr. Day', 'federal', true),
  ('US', '2027-02-15', 'Presidents'' Day', 'federal', true),
  ('US', '2027-05-31', 'Memorial Day', 'federal', true),
  ('US', '2027-06-18', 'Juneteenth (observed)', 'observed', true),
  ('US', '2027-06-19', 'Juneteenth', 'federal', true),
  ('US', '2027-07-04', 'Independence Day', 'federal', true),
  ('US', '2027-07-05', 'Independence Day (observed)', 'observed', true),
  ('US', '2027-09-06', 'Labor Day', 'federal', true),
  ('US', '2027-10-11', 'Columbus Day', 'federal', true),
  ('US', '2027-11-11', 'Veterans Day', 'federal', true),
  ('US', '2027-11-25', 'Thanksgiving Day', 'federal', true),
  ('US', '2027-12-24', 'Christmas Day (observed)', 'observed', true),
  ('US', '2027-12-25', 'Christmas Day', 'federal', true),
  ('US', '2027-12-31', 'New Year''s Day 2028 (observed)', 'observed', true),
  ('PH', '2026-01-01', 'New Year''s Day', 'regular', false),
  ('PH', '2026-02-17', 'Chinese New Year', 'special_non_working', false),
  ('PH', '2026-04-02', 'Maundy Thursday', 'regular', false),
  ('PH', '2026-04-03', 'Good Friday', 'regular', false),
  ('PH', '2026-04-04', 'Black Saturday', 'special_non_working', false),
  ('PH', '2026-04-09', 'Araw ng Kagitingan', 'regular', false),
  ('PH', '2026-05-01', 'Labor Day', 'regular', false),
  ('PH', '2026-06-12', 'Independence Day', 'regular', false),
  ('PH', '2026-08-21', 'Ninoy Aquino Day', 'special_non_working', false),
  ('PH', '2026-08-31', 'National Heroes Day', 'regular', false),
  ('PH', '2026-11-01', 'All Saints'' Day', 'special_non_working', false),
  ('PH', '2026-11-30', 'Bonifacio Day', 'regular', false),
  ('PH', '2026-12-08', 'Feast of the Immaculate Conception', 'special_non_working', false),
  ('PH', '2026-12-24', 'Christmas Eve', 'special_non_working', false),
  ('PH', '2026-12-25', 'Christmas Day', 'regular', false),
  ('PH', '2026-12-30', 'Rizal Day', 'regular', false),
  ('PH', '2026-12-31', 'Last Day of the Year', 'special_non_working', false),
  ('PH', '2027-01-01', 'New Year''s Day', 'regular', false),
  ('PH', '2027-03-25', 'Maundy Thursday', 'regular', false),
  ('PH', '2027-03-26', 'Good Friday', 'regular', false),
  ('PH', '2027-03-27', 'Black Saturday', 'special_non_working', false),
  ('PH', '2027-04-09', 'Araw ng Kagitingan', 'regular', false),
  ('PH', '2027-05-01', 'Labor Day', 'regular', false),
  ('PH', '2027-06-12', 'Independence Day', 'regular', false),
  ('PH', '2027-08-21', 'Ninoy Aquino Day', 'special_non_working', false),
  ('PH', '2027-08-30', 'National Heroes Day', 'regular', false),
  ('PH', '2027-11-01', 'All Saints'' Day', 'special_non_working', false),
  ('PH', '2027-11-30', 'Bonifacio Day', 'regular', false),
  ('PH', '2027-12-08', 'Feast of the Immaculate Conception', 'special_non_working', false),
  ('PH', '2027-12-24', 'Christmas Eve', 'special_non_working', false),
  ('PH', '2027-12-25', 'Christmas Day', 'regular', false),
  ('PH', '2027-12-30', 'Rizal Day', 'regular', false),
  ('PH', '2027-12-31', 'Last Day of the Year', 'special_non_working', false)
ON CONFLICT DO NOTHING;
