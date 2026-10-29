CREATE TABLE "time"."jibble_mismatch_notices" (
	"mismatch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_mismatch_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."jibble_mismatch_notices" ADD CONSTRAINT "jibble_mismatch_notices_mismatch_id_jibble_mismatches_id_fk" FOREIGN KEY ("mismatch_id") REFERENCES "time"."jibble_mismatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jibble_mismatch_notice_unique_idx" ON "time"."jibble_mismatch_notices" USING btree ("mismatch_id","user_id");