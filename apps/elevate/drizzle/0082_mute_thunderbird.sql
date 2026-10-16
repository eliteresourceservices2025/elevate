ALTER TABLE "core"."employees" ADD COLUMN "talenthr_id" text;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_merged_into_id_employees_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_merged_into_idx" ON "core"."employees" USING btree ("merged_into_id") WHERE "core"."employees"."merged_into_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_talenthr_idx" ON "core"."employees" USING btree ("talenthr_id") WHERE "core"."employees"."talenthr_id" is not null;