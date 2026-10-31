CREATE TABLE "learn"."assignment_due_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"previous_due_on" date NOT NULL,
	"due_on" date NOT NULL,
	"reason" text NOT NULL,
	"changed_by" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_due_changes_reason_chk" CHECK (char_length("learn"."assignment_due_changes"."reason") between 3 and 500),
	CONSTRAINT "assignment_due_changes_date_chk" CHECK ("learn"."assignment_due_changes"."previous_due_on" <> "learn"."assignment_due_changes"."due_on")
);
--> statement-breakpoint
ALTER TABLE "learn"."assignment_due_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "learn"."assignment_due_changes" ADD CONSTRAINT "assignment_due_changes_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignment_due_changes" ADD CONSTRAINT "assignment_due_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_due_changes_assignment_idx" ON "learn"."assignment_due_changes" USING btree ("assignment_id","changed_at");