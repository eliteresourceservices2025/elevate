CREATE TABLE "talent"."email_templates" (
	"kind" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_kind_chk" CHECK ("talent"."email_templates"."kind" in ('received','rejection','not_qualified'))
);
--> statement-breakpoint
ALTER TABLE "talent"."email_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."email_templates" ADD CONSTRAINT "email_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;