CREATE TABLE "time"."daily_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"minutes" integer NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_hours_minutes_chk" CHECK ("time"."daily_hours"."minutes" between 1 and 960)
);
--> statement-breakpoint
ALTER TABLE "time"."daily_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."daily_hours" ADD CONSTRAINT "daily_hours_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_hours_unique_idx" ON "time"."daily_hours" USING btree ("employee_id","date");