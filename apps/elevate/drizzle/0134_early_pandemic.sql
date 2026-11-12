CREATE TABLE "ops"."invoice_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"replaced_by" uuid,
	"reason_enc" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "invoice_events_kind_chk" CHECK ("ops"."invoice_events"."kind" in ('archived','restored','voided','superseded'))
);
--> statement-breakpoint
ALTER TABLE "ops"."invoice_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."client_bill_rates" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."invoice_events" ADD CONSTRAINT "invoice_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "ops"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."invoice_events" ADD CONSTRAINT "invoice_events_replaced_by_invoices_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "ops"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."invoice_events" ADD CONSTRAINT "invoice_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_events_invoice_idx" ON "ops"."invoice_events" USING btree ("invoice_id","created_at");--> statement-breakpoint
ALTER TABLE "ops"."client_bill_rates" ADD CONSTRAINT "client_bill_rates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_bill_rates_person_idx" ON "ops"."client_bill_rates" USING btree ("client_id","employee_id","effective_from");--> statement-breakpoint
-- Added by hand: an event is a fact that is never changed or removed (the same protection as invoices and rates).
CREATE TRIGGER invoice_events_append_only BEFORE UPDATE OR DELETE ON ops.invoice_events FOR EACH ROW EXECUTE FUNCTION ops.reject_invoice_change();--> statement-breakpoint
CREATE TRIGGER invoice_events_no_truncate BEFORE TRUNCATE ON ops.invoice_events FOR EACH STATEMENT EXECUTE FUNCTION ops.reject_invoice_change();
