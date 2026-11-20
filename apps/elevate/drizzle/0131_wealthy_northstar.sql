CREATE TABLE "ops"."client_bill_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"rate_enc" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."client_bill_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"year" smallint NOT NULL,
	"seq" integer NOT NULL,
	"revision" smallint DEFAULT 1 NOT NULL,
	"run_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"run_status" text NOT NULL,
	"issued_on" date NOT NULL,
	"payload_enc" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_run_client_revision_uq" UNIQUE("run_id","client_id","revision"),
	CONSTRAINT "invoices_revision_chk" CHECK ("ops"."invoices"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ops"."invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."client_bill_rates" ADD CONSTRAINT "client_bill_rates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."client_bill_rates" ADD CONSTRAINT "client_bill_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_bill_rates_client_idx" ON "ops"."client_bill_rates" USING btree ("client_id","effective_from");--> statement-breakpoint
CREATE INDEX "invoices_created_idx" ON "ops"."invoices" USING btree ("created_at");--> statement-breakpoint
-- Added by hand: the run foreign key (this module does not import payroll's schema) and the append-only protections.
ALTER TABLE "ops"."invoices" ADD CONSTRAINT "invoices_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION ops.reject_invoice_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER client_bill_rates_append_only BEFORE UPDATE OR DELETE ON ops.client_bill_rates FOR EACH ROW EXECUTE FUNCTION ops.reject_invoice_change();--> statement-breakpoint
CREATE TRIGGER client_bill_rates_no_truncate BEFORE TRUNCATE ON ops.client_bill_rates FOR EACH STATEMENT EXECUTE FUNCTION ops.reject_invoice_change();--> statement-breakpoint
CREATE TRIGGER invoices_append_only BEFORE UPDATE OR DELETE ON ops.invoices FOR EACH ROW EXECUTE FUNCTION ops.reject_invoice_change();--> statement-breakpoint
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON ops.invoices FOR EACH STATEMENT EXECUTE FUNCTION ops.reject_invoice_change();