CREATE TABLE "time"."clock_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"source" text NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clock_source_source_chk" CHECK ("time"."clock_source"."source" in ('elevate','jibble'))
);
--> statement-breakpoint
ALTER TABLE "time"."clock_source" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."jibble_client_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"jibble_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jibble_client_map_kind_chk" CHECK ("time"."jibble_client_map"."kind" in ('project','activity'))
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_client_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time"."jibble_unmapped_ids" (
	"kind" text NOT NULL,
	"jibble_id" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"example_employee_id" uuid,
	CONSTRAINT "jibble_unmapped_kind_chk" CHECK ("time"."jibble_unmapped_ids"."kind" in ('project','activity'))
);
--> statement-breakpoint
ALTER TABLE "time"."jibble_unmapped_ids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."clock_events" DROP CONSTRAINT "clock_events_source_chk";--> statement-breakpoint
ALTER TABLE "time"."clock_events" DROP CONSTRAINT "clock_events_correction_chk";--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD COLUMN "jibble_entry_id" text;--> statement-breakpoint
ALTER TABLE "time"."clock_source" ADD CONSTRAINT "clock_source_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."jibble_client_map" ADD CONSTRAINT "jibble_client_map_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."jibble_unmapped_ids" ADD CONSTRAINT "jibble_unmapped_ids_example_employee_id_employees_id_fk" FOREIGN KEY ("example_employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clock_source_employee_idx" ON "time"."clock_source" USING btree ("employee_id","set_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jibble_client_map_idx" ON "time"."jibble_client_map" USING btree ("kind","jibble_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jibble_unmapped_ids_idx" ON "time"."jibble_unmapped_ids" USING btree ("kind","jibble_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clock_events_jibble_entry_idx" ON "time"."clock_events" USING btree ("jibble_entry_id","type","occurred_at",coalesce("client_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "time"."clock_events"."jibble_entry_id" is not null;--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_jibble_chk" CHECK (("time"."clock_events"."source" = 'jibble') = ("time"."clock_events"."jibble_entry_id" is not null));--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_source_chk" CHECK ("time"."clock_events"."source" in ('web','admin_correction','jibble'));--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_correction_chk" CHECK (("time"."clock_events"."source" in ('web','jibble')) or ("time"."clock_events"."correction_id" is not null and coalesce(length(trim("time"."clock_events"."correction_reason")), 0) > 0));--> statement-breakpoint
-- The view carries "e.*" as it was when last recreated: refresh it so it also has jibble_entry_id.
CREATE OR REPLACE VIEW time.v_clock_events AS
  SELECT e.* FROM time.clock_events e
  WHERE NOT EXISTS (SELECT 1 FROM time.clock_event_voids v WHERE v.event_id = e.id);
--> statement-breakpoint
-- Where a person's hours come from is a record of who decided it: nobody can edit or remove a row, even with direct database access.
-- A change is a newer row.
CREATE OR REPLACE FUNCTION time.reject_clock_source_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'time.clock_source is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER clock_source_no_update_delete
  BEFORE UPDATE OR DELETE ON time.clock_source
  FOR EACH ROW EXECUTE FUNCTION time.reject_clock_source_change();
--> statement-breakpoint
CREATE TRIGGER clock_source_no_truncate
  BEFORE TRUNCATE ON time.clock_source
  FOR EACH STATEMENT EXECUTE FUNCTION time.reject_clock_source_change();
