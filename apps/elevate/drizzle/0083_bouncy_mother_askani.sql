CREATE TABLE "learn"."pending_assignments" (
	"employee_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"track" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_assignments_employee_id_course_id_pk" PRIMARY KEY("employee_id","course_id"),
	CONSTRAINT "pending_assignments_track_chk" CHECK ("learn"."pending_assignments"."track" in ('full','essentials','refresher'))
);
--> statement-breakpoint
ALTER TABLE "learn"."pending_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learn"."pending_assignments" ADD CONSTRAINT "pending_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."pending_assignments" ADD CONSTRAINT "pending_assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."pending_assignments" ADD CONSTRAINT "pending_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;