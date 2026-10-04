CREATE TABLE "ops"."golive_items" (
	"key" text PRIMARY KEY NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "ops"."golive_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."golive_items" ADD CONSTRAINT "golive_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;