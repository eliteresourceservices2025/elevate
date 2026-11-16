CREATE TABLE "time"."attendance_day_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"client_id" uuid,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time"."attendance_day_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."clock_events" DROP CONSTRAINT "clock_events_type_chk";--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "time"."hours_approvals" ADD COLUMN "client_split" jsonb;--> statement-breakpoint
ALTER TABLE "time"."attendance_day_clients" ADD CONSTRAINT "attendance_day_clients_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."attendance_day_clients" ADD CONSTRAINT "attendance_day_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_day_clients_unique_idx" ON "time"."attendance_day_clients" USING btree ("employee_id","date",coalesce("client_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "attendance_day_clients_date_idx" ON "time"."attendance_day_clients" USING btree ("date");--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_client_chk" CHECK (("time"."clock_events"."client_id" is null or "time"."clock_events"."type" in ('clock_in','switch_client')) and ("time"."clock_events"."type" <> 'switch_client' or "time"."clock_events"."client_id" is not null));--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_type_chk" CHECK ("time"."clock_events"."type" in ('clock_in','break_start','break_end','clock_out','switch_client'));--> statement-breakpoint
-- The view was created with "e.*", which Postgres fixes at that moment: recreate it so it also carries the new client_id column.
CREATE OR REPLACE VIEW time.v_clock_events AS
  SELECT e.* FROM time.clock_events e
  WHERE NOT EXISTS (SELECT 1 FROM time.clock_event_voids v WHERE v.event_id = e.id);
