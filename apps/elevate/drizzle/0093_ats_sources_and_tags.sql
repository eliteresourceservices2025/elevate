CREATE TABLE "talent"."application_tags" (
	"application_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_tags_application_id_tag_id_pk" PRIMARY KEY("application_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "talent"."application_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "talent"."tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "talent"."tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD COLUMN "source_detail" text;--> statement-breakpoint
ALTER TABLE "talent"."application_tags" ADD CONSTRAINT "application_tags_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "talent"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."application_tags" ADD CONSTRAINT "application_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "talent"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."application_tags" ADD CONSTRAINT "application_tags_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."tags" ADD CONSTRAINT "tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_tags_tag_idx" ON "talent"."application_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_idx" ON "talent"."tags" USING btree (lower("name")) WHERE "talent"."tags"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "talent"."applications" ADD CONSTRAINT "applications_source_chk" CHECK ("talent"."applications"."source" is null or "talent"."applications"."source" in ('careers_page','referral','linkedin','facebook','job_board','agency','other'));