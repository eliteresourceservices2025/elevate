CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TABLE "ops"."audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "ops"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."roles" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."user_roles" (
	"user_id" uuid NOT NULL,
	"role_slug" text NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_slug_pk" PRIMARY KEY("user_id","role_slug")
);
--> statement-breakpoint
ALTER TABLE "core"."user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."users" ADD COLUMN "is_safevoice_handler" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."user_roles" ADD CONSTRAINT "user_roles_role_slug_roles_slug_fk" FOREIGN KEY ("role_slug") REFERENCES "core"."roles"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "ops"."audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "ops"."audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "ops"."audit_log" USING btree ("target_type","target_id");