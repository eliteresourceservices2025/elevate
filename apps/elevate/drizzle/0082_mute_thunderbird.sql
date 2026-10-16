-- Safe to run on a database that already has the first version of this migration (which added only talenthr_id and its index), and on
-- one that has nothing of it: every statement skips what is already there.
ALTER TABLE "core"."employees" ADD COLUMN IF NOT EXISTS "talenthr_id" text;--> statement-breakpoint
ALTER TABLE "core"."employees" ADD COLUMN IF NOT EXISTS "merged_into_id" uuid;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_merged_into_id_employees_id_fk') THEN
    ALTER TABLE "core"."employees" ADD CONSTRAINT "employees_merged_into_id_employees_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_merged_into_idx" ON "core"."employees" USING btree ("merged_into_id") WHERE "core"."employees"."merged_into_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employees_talenthr_idx" ON "core"."employees" USING btree ("talenthr_id") WHERE "core"."employees"."talenthr_id" is not null;
