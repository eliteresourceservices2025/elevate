CREATE TABLE "payroll"."pay_run_signatures" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"signatory_id" uuid NOT NULL,
	"signed_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_signatures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll"."pay_signatory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"signature_enc" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_signatory_text_chk" CHECK (char_length("payroll"."pay_signatory"."name") between 1 and 120 and char_length("payroll"."pay_signatory"."title") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "payroll"."pay_signatory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_signatures" ADD CONSTRAINT "pay_run_signatures_run_id_pay_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_run_signatures" ADD CONSTRAINT "pay_run_signatures_signatory_id_pay_signatory_id_fk" FOREIGN KEY ("signatory_id") REFERENCES "payroll"."pay_signatory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."pay_signatory" ADD CONSTRAINT "pay_signatory_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;