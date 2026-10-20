CREATE TABLE "docs"."system_documents" (
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_documents_source_kind_source_id_employee_id_pk" PRIMARY KEY("source_kind","source_id","employee_id"),
	CONSTRAINT "system_documents_kind_chk" CHECK ("docs"."system_documents"."source_kind" in ('learn_certificate','esign_signer'))
);
--> statement-breakpoint
ALTER TABLE "docs"."system_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "docs"."system_documents" ADD CONSTRAINT "system_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."system_documents" ADD CONSTRAINT "system_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "docs"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "system_documents_document_idx" ON "docs"."system_documents" USING btree ("document_id");--> statement-breakpoint
-- The two kinds of file ELEVATE files for a person by itself. Not required for anyone (nobody is "missing" one).
INSERT INTO docs.document_types (slug, name, scope, requires_expiry, requires_client, required_for_all) VALUES
  ('training_certificate', 'Training certificate', 'employee', false, false, false),
  ('signed_document',      'Signed document',      'employee', false, false, false)
ON CONFLICT (slug) DO NOTHING;
