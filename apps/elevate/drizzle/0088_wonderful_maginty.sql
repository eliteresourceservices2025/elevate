CREATE TABLE "time"."clock_event_voids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"voided_by" uuid NOT NULL,
	"correction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clock_event_voids_reason_chk" CHECK (char_length("time"."clock_event_voids"."reason") between 5 and 300)
);
--> statement-breakpoint
ALTER TABLE "time"."clock_event_voids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."clock_corrections" ADD COLUMN "void_event_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "time"."clock_event_voids" ADD CONSTRAINT "clock_event_voids_event_id_clock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "time"."clock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_event_voids" ADD CONSTRAINT "clock_event_voids_correction_id_clock_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "time"."clock_corrections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clock_event_voids_event_idx" ON "time"."clock_event_voids" USING btree ("event_id");--> statement-breakpoint
-- A void is evidence like the event it marks: nobody can change or remove one, even as the owner role. A wrong void is undone by adding the event back.
CREATE OR REPLACE FUNCTION time.reject_clock_event_void_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'time.clock_event_voids is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER clock_event_voids_no_update_delete
  BEFORE UPDATE OR DELETE ON time.clock_event_voids
  FOR EACH ROW EXECUTE FUNCTION time.reject_clock_event_void_change();
--> statement-breakpoint
CREATE TRIGGER clock_event_voids_no_truncate
  BEFORE TRUNCATE ON time.clock_event_voids
  FOR EACH STATEMENT EXECUTE FUNCTION time.reject_clock_event_void_change();
--> statement-breakpoint
-- The clock events that count: every event except the ones a void removed. Hours, the clock's state and every check read this, never the raw table.
CREATE VIEW time.v_clock_events AS
  SELECT e.* FROM time.clock_events e
  WHERE NOT EXISTS (SELECT 1 FROM time.clock_event_voids v WHERE v.event_id = e.id);
