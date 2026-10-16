CREATE TABLE "docs"."popup_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"announcement_id" uuid,
	"policy_version_id" uuid,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "popup_dismissals_subject_chk" CHECK (("docs"."popup_dismissals"."announcement_id" is null) <> ("docs"."popup_dismissals"."policy_version_id" is null))
);
--> statement-breakpoint
ALTER TABLE "docs"."popup_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."popups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid,
	"policy_id" uuid,
	"show_from" date NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "popups_subject_chk" CHECK (("docs"."popups"."announcement_id" is null) <> ("docs"."popups"."policy_id" is null))
);
--> statement-breakpoint
ALTER TABLE "docs"."popups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "docs"."popup_dismissals" ADD CONSTRAINT "popup_dismissals_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "docs"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."popup_dismissals" ADD CONSTRAINT "popup_dismissals_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "docs"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."popups" ADD CONSTRAINT "popups_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "docs"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."popups" ADD CONSTRAINT "popups_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "docs"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "popup_dismissals_announcement_idx" ON "docs"."popup_dismissals" USING btree ("user_id","announcement_id") WHERE "docs"."popup_dismissals"."announcement_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "popup_dismissals_policy_idx" ON "docs"."popup_dismissals" USING btree ("user_id","policy_version_id") WHERE "docs"."popup_dismissals"."policy_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "popups_announcement_idx" ON "docs"."popups" USING btree ("announcement_id") WHERE "docs"."popups"."announcement_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "popups_policy_idx" ON "docs"."popups" USING btree ("policy_id") WHERE "docs"."popups"."policy_id" is not null;--> statement-breakpoint
CREATE INDEX "popups_queue_idx" ON "docs"."popups" USING btree ("show_from","sort_order");