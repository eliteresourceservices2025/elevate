CREATE TABLE "docs"."document_audience_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"team_id" uuid,
	"client_id" uuid,
	"role_slug" text,
	"employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_audience_kind_chk" CHECK ("docs"."document_audience_members"."kind" in ('team','client','role','person')),
	CONSTRAINT "document_audience_one_ref_chk" CHECK (("docs"."document_audience_members"."kind" = 'team' and "docs"."document_audience_members"."team_id" is not null and "docs"."document_audience_members"."client_id" is null and "docs"."document_audience_members"."role_slug" is null and "docs"."document_audience_members"."employee_id" is null)
          or ("docs"."document_audience_members"."kind" = 'client' and "docs"."document_audience_members"."client_id" is not null and "docs"."document_audience_members"."team_id" is null and "docs"."document_audience_members"."role_slug" is null and "docs"."document_audience_members"."employee_id" is null)
          or ("docs"."document_audience_members"."kind" = 'role' and "docs"."document_audience_members"."role_slug" is not null and "docs"."document_audience_members"."team_id" is null and "docs"."document_audience_members"."client_id" is null and "docs"."document_audience_members"."employee_id" is null)
          or ("docs"."document_audience_members"."kind" = 'person' and "docs"."document_audience_members"."employee_id" is not null and "docs"."document_audience_members"."team_id" is null and "docs"."document_audience_members"."client_id" is null and "docs"."document_audience_members"."role_slug" is null))
);
--> statement-breakpoint
ALTER TABLE "docs"."document_audience_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "docs"."documents" DROP CONSTRAINT "documents_audience_chk";--> statement-breakpoint
ALTER TABLE "docs"."document_audience_members" ADD CONSTRAINT "document_audience_members_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "docs"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."document_audience_members" ADD CONSTRAINT "document_audience_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "core"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."document_audience_members" ADD CONSTRAINT "document_audience_members_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."document_audience_members" ADD CONSTRAINT "document_audience_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_audience_document_idx" ON "docs"."document_audience_members" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD CONSTRAINT "documents_audience_chk" CHECK ("docs"."documents"."audience" in ('all_staff','hr_only','restricted'));