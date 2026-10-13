ALTER TABLE "learn"."courses" ADD COLUMN "kind" text DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD COLUMN "noun" text;--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD COLUMN "fixed_track" text;--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD CONSTRAINT "courses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD CONSTRAINT "courses_kind_chk" CHECK ("learn"."courses"."kind" in ('core', 'client_addon'));--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD CONSTRAINT "courses_client_chk" CHECK (("learn"."courses"."kind" = 'core' and "learn"."courses"."client_id" is null) or ("learn"."courses"."kind" = 'client_addon' and "learn"."courses"."client_id" is not null));--> statement-breakpoint
ALTER TABLE "learn"."courses" ADD CONSTRAINT "courses_fixed_track_chk" CHECK ("learn"."courses"."fixed_track" is null or "learn"."courses"."fixed_track" in ('full', 'essentials', 'refresher'));