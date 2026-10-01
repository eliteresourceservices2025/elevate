ALTER TABLE "time"."clock_corrections" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX "clock_corrections_batch_idx" ON "time"."clock_corrections" USING btree ("batch_id");