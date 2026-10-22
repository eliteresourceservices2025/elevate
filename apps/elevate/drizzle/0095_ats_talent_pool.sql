ALTER TABLE "talent"."candidates" ADD COLUMN "pool_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent"."candidates" ADD COLUMN "pool_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent"."candidates" ADD COLUMN "in_pool" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "talent"."candidates" ADD COLUMN "in_pool_by" uuid;--> statement-breakpoint
ALTER TABLE "talent"."candidates" ADD COLUMN "in_pool_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talent"."candidates" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "talent"."candidates" ADD CONSTRAINT "candidates_in_pool_by_users_id_fk" FOREIGN KEY ("in_pool_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent"."candidates" ADD CONSTRAINT "candidates_pool_chk" CHECK (not "talent"."candidates"."in_pool" or ("talent"."candidates"."pool_consent_at" is not null and "talent"."candidates"."pool_expires_at" is not null));