CREATE TABLE "docs"."document_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_folders_name_chk" CHECK (char_length("docs"."document_folders"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "docs"."document_folders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "docs"."document_folders" ADD CONSTRAINT "document_folders_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_folders_name_idx" ON "docs"."document_folders" USING btree ("employee_id",lower("name")) WHERE "docs"."document_folders"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "document_folders_employee_idx" ON "docs"."document_folders" USING btree ("employee_id");--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD CONSTRAINT "documents_folder_id_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "docs"."document_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_folder_idx" ON "docs"."documents" USING btree ("folder_id");--> statement-breakpoint
-- Files that came over from TalentHR are put in one folder per person, so a long list is not one big pile.
INSERT INTO "docs"."document_folders" ("employee_id", "name")
SELECT DISTINCT d."employee_id", 'Imported from TalentHR'
FROM "docs"."documents" d
JOIN "docs"."document_types" t ON t."id" = d."type_id"
WHERE t."slug" = 'talenthr_import' AND d."employee_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "docs"."documents" d
SET "folder_id" = f."id"
FROM "docs"."document_folders" f, "docs"."document_types" t
WHERE t."id" = d."type_id" AND t."slug" = 'talenthr_import'
  AND f."employee_id" = d."employee_id" AND f."name" = 'Imported from TalentHR' AND f."archived_at" IS NULL
  AND d."folder_id" IS NULL;
