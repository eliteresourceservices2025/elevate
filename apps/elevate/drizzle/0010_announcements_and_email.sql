CREATE TABLE "docs"."acknowledgment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid,
	"policy_version_id" uuid,
	"reminder_date" date NOT NULL,
	"kind" text NOT NULL,
	"sent_by" uuid,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ack_reminders_kind_chk" CHECK ("docs"."acknowledgment_reminders"."kind" in ('scheduled','manual')),
	CONSTRAINT "ack_reminders_subject_chk" CHECK (("docs"."acknowledgment_reminders"."announcement_id" is null) <> ("docs"."acknowledgment_reminders"."policy_version_id" is null))
);
--> statement-breakpoint
ALTER TABLE "docs"."acknowledgment_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."acknowledgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"announcement_id" uuid,
	"policy_version_id" uuid,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acknowledgments_subject_chk" CHECK (("docs"."acknowledgments"."announcement_id" is null) <> ("docs"."acknowledgments"."policy_version_id" is null))
);
--> statement-breakpoint
ALTER TABLE "docs"."acknowledgments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."announcement_recipients" (
	"announcement_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	CONSTRAINT "announcement_recipients_announcement_id_employee_id_pk" PRIMARY KEY("announcement_id","employee_id")
);
--> statement-breakpoint
ALTER TABLE "docs"."announcement_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."announcement_teams" (
	"announcement_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "announcement_teams_announcement_id_team_id_pk" PRIMARY KEY("announcement_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "docs"."announcement_teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"requires_ack" boolean DEFAULT false NOT NULL,
	"due_on" date,
	"attachment_document_id" uuid,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_audience_chk" CHECK ("docs"."announcements"."audience" in ('all','teams')),
	CONSTRAINT "announcements_due_chk" CHECK ("docs"."announcements"."due_on" is null or "docs"."announcements"."requires_ack")
);
--> statement-breakpoint
ALTER TABLE "docs"."announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'general' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_kind_chk" CHECK ("docs"."policies"."kind" in ('general','privacy_notice','monitoring'))
);
--> statement-breakpoint
ALTER TABLE "docs"."policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "docs"."policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"change_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"requires_ack" boolean DEFAULT true NOT NULL,
	"due_on" date,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_status_chk" CHECK ("docs"."policy_versions"."status" in ('draft','published')),
	CONSTRAINT "policy_versions_published_chk" CHECK ("docs"."policy_versions"."status" = 'draft' or ("docs"."policy_versions"."published_at" is not null and "docs"."policy_versions"."published_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "docs"."policy_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."email_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"digest_opt_out" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."email_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."email_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"priority" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"link" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_queue_kind_chk" CHECK ("ops"."email_queue"."kind" in ('ack_due','digest')),
	CONSTRAINT "email_queue_status_chk" CHECK ("ops"."email_queue"."status" in ('queued','sent','failed','skipped'))
);
--> statement-breakpoint
ALTER TABLE "ops"."email_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "docs"."acknowledgment_reminders" ADD CONSTRAINT "acknowledgment_reminders_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "docs"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."acknowledgment_reminders" ADD CONSTRAINT "acknowledgment_reminders_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "docs"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."acknowledgments" ADD CONSTRAINT "acknowledgments_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "docs"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."acknowledgments" ADD CONSTRAINT "acknowledgments_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "docs"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "docs"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."announcement_recipients" ADD CONSTRAINT "announcement_recipients_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."announcement_teams" ADD CONSTRAINT "announcement_teams_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "docs"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."announcement_teams" ADD CONSTRAINT "announcement_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "core"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."announcements" ADD CONSTRAINT "announcements_attachment_document_id_documents_id_fk" FOREIGN KEY ("attachment_document_id") REFERENCES "docs"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs"."policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "docs"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."email_preferences" ADD CONSTRAINT "email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."email_queue" ADD CONSTRAINT "email_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ack_reminders_announcement_idx" ON "docs"."acknowledgment_reminders" USING btree ("announcement_id","reminder_date","kind") WHERE "docs"."acknowledgment_reminders"."announcement_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ack_reminders_policy_idx" ON "docs"."acknowledgment_reminders" USING btree ("policy_version_id","reminder_date","kind") WHERE "docs"."acknowledgment_reminders"."policy_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "acknowledgments_announcement_idx" ON "docs"."acknowledgments" USING btree ("user_id","announcement_id") WHERE "docs"."acknowledgments"."announcement_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "acknowledgments_policy_idx" ON "docs"."acknowledgments" USING btree ("user_id","policy_version_id") WHERE "docs"."acknowledgments"."policy_version_id" is not null;--> statement-breakpoint
CREATE INDEX "acknowledgments_announcement_lookup_idx" ON "docs"."acknowledgments" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "acknowledgments_policy_lookup_idx" ON "docs"."acknowledgments" USING btree ("policy_version_id");--> statement-breakpoint
CREATE INDEX "announcement_recipients_employee_idx" ON "docs"."announcement_recipients" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "announcements_feed_idx" ON "docs"."announcements" USING btree ("archived_at","pinned","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_slug_idx" ON "docs"."policies" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_special_kind_idx" ON "docs"."policies" USING btree ("kind") WHERE "docs"."policies"."kind" <> 'general';--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_number_idx" ON "docs"."policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_one_draft_idx" ON "docs"."policy_versions" USING btree ("policy_id") WHERE "docs"."policy_versions"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "email_queue_dedupe_idx" ON "ops"."email_queue" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "email_queue_pending_idx" ON "ops"."email_queue" USING btree ("priority","created_at") WHERE "ops"."email_queue"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "email_queue_sent_idx" ON "ops"."email_queue" USING btree ("sent_at") WHERE "ops"."email_queue"."status" = 'sent';