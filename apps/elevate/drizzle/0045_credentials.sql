CREATE TABLE "talent"."credential_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"days_before" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_reminders_days_chk" CHECK ("talent"."credential_reminders"."days_before" in (30, 7, 0))
);
--> statement-breakpoint
ALTER TABLE "talent"."credential_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"issued_on" date,
	"expires_on" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_source_chk" CHECK ("talent"."credentials"."source" in ('manual','talenthr')),
	CONSTRAINT "credentials_name_chk" CHECK (char_length("talent"."credentials"."name") between 2 and 120),
	CONSTRAINT "credentials_dates_chk" CHECK ("talent"."credentials"."issued_on" is null or "talent"."credentials"."issued_on" <= "talent"."credentials"."expires_on")
);
--> statement-breakpoint
ALTER TABLE "talent"."credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."credential_reminders" ADD CONSTRAINT "credential_reminders_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "talent"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."credentials" ADD CONSTRAINT "credentials_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."credentials" ADD CONSTRAINT "credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_reminders_unique_idx" ON "talent"."credential_reminders" USING btree ("credential_id","days_before");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_unique_idx" ON "talent"."credentials" USING btree ("employee_id",lower("name"),"expires_on") WHERE "talent"."credentials"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "credentials_expiry_idx" ON "talent"."credentials" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "credentials_employee_idx" ON "talent"."credentials" USING btree ("employee_id");