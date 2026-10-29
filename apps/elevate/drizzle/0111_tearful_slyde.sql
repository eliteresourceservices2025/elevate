CREATE TABLE "time"."jibble_check_cursor" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_check_cursor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."jibble_check_cursor" ADD CONSTRAINT "jibble_check_cursor_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE cascade ON UPDATE no action;