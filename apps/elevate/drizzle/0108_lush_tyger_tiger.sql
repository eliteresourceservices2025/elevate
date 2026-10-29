CREATE TABLE "time"."jibble_call_reviews" (
	"log_id" uuid PRIMARY KEY NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_call_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."jibble_call_reviews" ADD CONSTRAINT "jibble_call_reviews_log_id_jibble_link_log_id_fk" FOREIGN KEY ("log_id") REFERENCES "time"."jibble_link_log"("id") ON DELETE cascade ON UPDATE no action;