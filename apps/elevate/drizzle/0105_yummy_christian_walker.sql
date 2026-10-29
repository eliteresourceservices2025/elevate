CREATE TABLE "time"."jibble_mismatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text,
	CONSTRAINT "jibble_mismatch_kind_chk" CHECK ("time"."jibble_mismatches"."kind" in ('working_jibble_out','working_jibble_break'))
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_mismatches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."jibble_mismatches" ADD CONSTRAINT "jibble_mismatches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jibble_mismatch_open_idx" ON "time"."jibble_mismatches" USING btree ("employee_id","kind") WHERE "time"."jibble_mismatches"."resolved_at" is null;