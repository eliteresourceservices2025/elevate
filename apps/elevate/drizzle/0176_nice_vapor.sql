CREATE TABLE "ops"."report_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_type" text NOT NULL,
	"report_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"body_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_messages_type_chk" CHECK ("ops"."report_messages"."report_type" in ('tech_issue','correction','support','extra_hours','makeup','time_off')),
	CONSTRAINT "report_messages_kind_chk" CHECK ("ops"."report_messages"."author_kind" in ('reporter','handler'))
);
--> statement-breakpoint
ALTER TABLE "ops"."report_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."report_messages" ADD CONSTRAINT "report_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_messages_report_idx" ON "ops"."report_messages" USING btree ("report_type","report_id","created_at");--> statement-breakpoint
-- Messages are never changed or deleted (the thread is part of the record of a report).
CREATE TRIGGER report_messages_append_only BEFORE UPDATE OR DELETE ON ops.report_messages FOR EACH ROW EXECUTE FUNCTION talent.reject_change();--> statement-breakpoint
CREATE TRIGGER report_messages_no_truncate BEFORE TRUNCATE ON ops.report_messages FOR EACH STATEMENT EXECUTE FUNCTION talent.reject_change();
