CREATE SCHEMA "time";
--> statement-breakpoint
CREATE TABLE "time"."holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_calendar_chk" CHECK ("time"."holidays"."calendar" in ('PH','US')),
	CONSTRAINT "holidays_kind_chk" CHECK ("time"."holidays"."kind" in ('regular','special_non_working','special_working','federal','observed','other'))
);
--> statement-breakpoint
ALTER TABLE "time"."holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."leave_expiry_reminders" (
	"award_id" uuid PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."leave_expiry_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."leave_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"days" numeric(5, 2) NOT NULL,
	"reason" text,
	"effective_on" date NOT NULL,
	"expires_on" date,
	"award_id" uuid,
	"request_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_ledger_type_chk" CHECK ("time"."leave_ledger"."entry_type" in ('award','usage','reversal','adjustment','expiry','opening_balance')),
	CONSTRAINT "leave_ledger_sign_chk" CHECK (("time"."leave_ledger"."entry_type" = 'award' and "time"."leave_ledger"."days" > 0)
         or ("time"."leave_ledger"."entry_type" = 'usage' and "time"."leave_ledger"."days" < 0)
         or ("time"."leave_ledger"."entry_type" = 'reversal' and "time"."leave_ledger"."days" > 0)
         or ("time"."leave_ledger"."entry_type" = 'adjustment' and "time"."leave_ledger"."days" <> 0)
         or ("time"."leave_ledger"."entry_type" = 'expiry' and "time"."leave_ledger"."days" <= 0)
         or ("time"."leave_ledger"."entry_type" = 'opening_balance' and "time"."leave_ledger"."days" >= 0)),
	CONSTRAINT "leave_ledger_expires_chk" CHECK ("time"."leave_ledger"."expires_on" is null or "time"."leave_ledger"."entry_type" = 'award'),
	CONSTRAINT "leave_ledger_award_ref_chk" CHECK (("time"."leave_ledger"."entry_type" = 'expiry') = ("time"."leave_ledger"."award_id" is not null)),
	CONSTRAINT "leave_ledger_reason_chk" CHECK ("time"."leave_ledger"."entry_type" not in ('award','adjustment') or length(trim("time"."leave_ledger"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "time"."leave_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tracks_balance" boolean NOT NULL,
	"skip_hr" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."leave_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."clients" ADD COLUMN "holiday_calendar" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."leave_expiry_reminders" ADD CONSTRAINT "leave_expiry_reminders_award_id_leave_ledger_id_fk" FOREIGN KEY ("award_id") REFERENCES "time"."leave_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."leave_ledger" ADD CONSTRAINT "leave_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "time"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_unique_idx" ON "time"."holidays" USING btree ("calendar","date",lower("name"));--> statement-breakpoint
CREATE INDEX "holidays_calendar_date_idx" ON "time"."holidays" USING btree ("calendar","date");--> statement-breakpoint
CREATE INDEX "leave_ledger_employee_idx" ON "time"."leave_ledger" USING btree ("employee_id","leave_type_id","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_expiry_once_idx" ON "time"."leave_ledger" USING btree ("award_id") WHERE "time"."leave_ledger"."entry_type" = 'expiry';--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_slug_idx" ON "time"."leave_types" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_name_idx" ON "time"."leave_types" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "core"."clients" ADD CONSTRAINT "clients_holiday_calendar_chk" CHECK ("core"."clients"."holiday_calendar" in ('PH','US'));