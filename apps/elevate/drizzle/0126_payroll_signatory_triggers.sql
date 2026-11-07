-- The payslip signatory (the Human Resources Director) and the version that signed each paid run: both append-only,
-- like every other payroll record. A change is a new version; a run keeps the version it was paid under.
CREATE TRIGGER pay_signatory_append_only BEFORE UPDATE OR DELETE ON payroll.pay_signatory FOR EACH ROW EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_signatory_no_truncate BEFORE TRUNCATE ON payroll.pay_signatory FOR EACH STATEMENT EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_run_signatures_append_only BEFORE UPDATE OR DELETE ON payroll.pay_run_signatures FOR EACH ROW EXECUTE FUNCTION payroll.reject_change();
--> statement-breakpoint
CREATE TRIGGER pay_run_signatures_no_truncate BEFORE TRUNCATE ON payroll.pay_run_signatures FOR EACH STATEMENT EXECUTE FUNCTION payroll.reject_change();
