CREATE TABLE "core"."anniversary_notices" (
	"employee_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"noticed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anniversary_notices_employee_id_year_pk" PRIMARY KEY("employee_id","year")
);
--> statement-breakpoint
ALTER TABLE "core"."anniversary_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"topic" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"page" text,
	"status" text DEFAULT 'open' NOT NULL,
	"emailed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	CONSTRAINT "support_requests_status_chk" CHECK ("ops"."support_requests"."status" in ('open','closed')),
	CONSTRAINT "support_requests_topic_chk" CHECK ("ops"."support_requests"."topic" in ('sign_in','time_clock','jibble','data','other'))
);
--> statement-breakpoint
ALTER TABLE "ops"."support_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."anniversary_notices" ADD CONSTRAINT "anniversary_notices_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."support_requests" ADD CONSTRAINT "support_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."support_requests" ADD CONSTRAINT "support_requests_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_requests_status_idx" ON "ops"."support_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_requests_user_idx" ON "ops"."support_requests" USING btree ("user_id","created_at");