CREATE TABLE "talent"."offer_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"body" text NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."offer_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"template_id" uuid,
	"template_name" text NOT NULL,
	"fields" jsonb NOT NULL,
	"rendered_body" text NOT NULL,
	"envelope_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent"."offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."onboarding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"offer_id" uuid,
	"start_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"hired_without_offer_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_cases_status_chk" CHECK ("talent"."onboarding_cases"."status" in ('open','completed','cancelled')),
	CONSTRAINT "onboarding_cases_reason_chk" CHECK (("talent"."onboarding_cases"."offer_id" is not null) or coalesce(length(trim("talent"."onboarding_cases"."hired_without_offer_reason")), 0) > 0)
);
--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "external_email" text;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "external_name" text;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "access_token_hash" text;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "code_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "code_sent_at" timestamp with time zone[];--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "session_hash" text;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "session_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent"."offer_templates" ADD CONSTRAINT "offer_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."offers" ADD CONSTRAINT "offers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "talent"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."offers" ADD CONSTRAINT "offers_template_id_offer_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "talent"."offer_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."offers" ADD CONSTRAINT "offers_envelope_id_esign_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "docs"."esign_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."offers" ADD CONSTRAINT "offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ADD CONSTRAINT "onboarding_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ADD CONSTRAINT "onboarding_cases_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "talent"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ADD CONSTRAINT "onboarding_cases_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "talent"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."onboarding_cases" ADD CONSTRAINT "onboarding_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_templates_name_idx" ON "talent"."offer_templates" USING btree (lower("name")) WHERE "talent"."offer_templates"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_envelope_idx" ON "talent"."offers" USING btree ("envelope_id") WHERE "talent"."offers"."envelope_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_cases_application_idx" ON "talent"."onboarding_cases" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_cases_employee_idx" ON "talent"."onboarding_cases" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "esign_signers_envelope_external_idx" ON "docs"."esign_signers" USING btree ("envelope_id",lower("external_email")) WHERE "docs"."esign_signers"."external_email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "esign_signers_token_idx" ON "docs"."esign_signers" USING btree ("access_token_hash") WHERE "docs"."esign_signers"."access_token_hash" is not null;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD CONSTRAINT "esign_signers_kind_one_chk" CHECK (("docs"."esign_signers"."user_id" is not null) <> ("docs"."esign_signers"."external_email" is not null) and ("docs"."esign_signers"."external_email" is null or "docs"."esign_signers"."external_name" is not null));