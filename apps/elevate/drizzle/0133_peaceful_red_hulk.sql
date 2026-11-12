CREATE TABLE "payroll"."pay_run_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"released_by" uuid NOT NULL,
	"people_count" integer NOT NULL,
	"released_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "pay_run_releases_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_releases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_releases" ADD CONSTRAINT "pay_run_releases_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_releases" ADD CONSTRAINT "pay_run_releases_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Added by hand: a release is a fact that is never changed or removed.
CREATE TRIGGER pay_run_releases_append_only BEFORE UPDATE OR DELETE ON payroll.pay_run_releases FOR EACH ROW EXECUTE FUNCTION payroll.reject_change();--> statement-breakpoint
CREATE TRIGGER pay_run_releases_no_truncate BEFORE TRUNCATE ON payroll.pay_run_releases FOR EACH STATEMENT EXECUTE FUNCTION payroll.reject_change();
