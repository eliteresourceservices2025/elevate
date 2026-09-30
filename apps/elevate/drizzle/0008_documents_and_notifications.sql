CREATE SCHEMA "docs";
--> statement-breakpoint
CREATE TABLE "docs"."document_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"days_before" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_reminders_days_chk" CHECK ("docs"."document_reminders"."days_before" in (30, 7, 0))
);
--> statement-breakpoint
ALTER TABLE "docs"."document_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."document_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"requires_expiry" boolean DEFAULT false NOT NULL,
	"requires_client" boolean DEFAULT false NOT NULL,
	"required_for_all" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_types_scope_chk" CHECK ("docs"."document_types"."scope" in ('employee','company'))
);
--> statement-breakpoint
ALTER TABLE "docs"."document_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" uuid NOT NULL,
	"employee_id" uuid,
	"client_id" uuid,
	"title" text NOT NULL,
	"audience" text DEFAULT 'all_staff' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_path" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"sha256" text,
	"expires_on" date,
	"uploaded_by" uuid NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_status_chk" CHECK ("docs"."documents"."status" in ('pending','active')),
	CONSTRAINT "documents_audience_chk" CHECK ("docs"."documents"."audience" in ('all_staff','hr_only')),
	CONSTRAINT "documents_size_chk" CHECK ("docs"."documents"."size_bytes" is null or ("docs"."documents"."size_bytes" > 0 and "docs"."documents"."size_bytes" <= 10485760))
);
--> statement-breakpoint
ALTER TABLE "docs"."documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ops"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "docs"."document_reminders" ADD CONSTRAINT "document_reminders_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "docs"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD CONSTRAINT "documents_type_id_document_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "docs"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD CONSTRAINT "documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_reminders_unique_idx" ON "docs"."document_reminders" USING btree ("document_id","days_before");--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_slug_idx" ON "docs"."document_types" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_name_idx" ON "docs"."document_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_path_idx" ON "docs"."documents" USING btree ("storage_bucket","storage_path");--> statement-breakpoint
CREATE INDEX "documents_employee_idx" ON "docs"."documents" USING btree ("employee_id","archived_at");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "docs"."documents" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "documents_expiry_idx" ON "docs"."documents" USING btree ("expires_on") WHERE "docs"."documents"."status" = 'active' and "docs"."documents"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "documents_pending_idx" ON "docs"."documents" USING btree ("created_at") WHERE "docs"."documents"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "ops"."notifications" USING btree ("user_id","read_at","created_at");