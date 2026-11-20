CREATE TABLE "core"."birthday_preferences" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."birthday_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."birthday_preferences" ADD CONSTRAINT "birthday_preferences_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;