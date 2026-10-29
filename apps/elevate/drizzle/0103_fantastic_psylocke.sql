CREATE TABLE "time"."jibble_operation_guard" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"token" uuid NOT NULL,
	"phase" text DEFAULT 'claimed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jibble_operation_guard_phase_chk" CHECK ("time"."jibble_operation_guard"."phase" in ('claimed','in_flight','uncertain'))
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_operation_guard" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."jibble_operation_guard" ADD CONSTRAINT "jibble_operation_guard_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;