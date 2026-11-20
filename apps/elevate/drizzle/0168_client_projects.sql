CREATE TABLE "core"."client_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."client_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."client_projects" ADD CONSTRAINT "client_projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_projects_name_idx" ON "core"."client_projects" USING btree ("client_id",lower("name")) WHERE "core"."client_projects"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "client_projects_client_idx" ON "core"."client_projects" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_project_id_client_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "core"."client_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time"."clock_events" ADD CONSTRAINT "clock_events_project_chk" CHECK ("time"."clock_events"."project_id" is null or ("time"."clock_events"."client_id" is not null and "time"."clock_events"."type" in ('clock_in','switch_client')));
--> statement-breakpoint
-- The view carries "e.*" as it was when last recreated: refresh it so it also has project_id.
CREATE OR REPLACE VIEW time.v_clock_events AS
  SELECT e.* FROM time.clock_events e
  WHERE NOT EXISTS (SELECT 1 FROM time.clock_event_voids v WHERE v.event_id = e.id);
--> statement-breakpoint
-- A clock event's project must be a project of the event's own client. Checked here so no code path can record a mismatch.
CREATE OR REPLACE FUNCTION time.check_clock_event_project() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.client_projects p WHERE p.id = NEW.project_id AND p.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'The project does not belong to the client of this clock event';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER clock_events_project_client BEFORE INSERT ON time.clock_events FOR EACH ROW EXECUTE FUNCTION time.check_clock_event_project();
--> statement-breakpoint
-- A project never moves to another client: the time already recorded against it would change meaning.
CREATE OR REPLACE FUNCTION core.reject_project_client_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'A project cannot move to another client';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER client_projects_keep_client BEFORE UPDATE ON core.client_projects FOR EACH ROW EXECUTE FUNCTION core.reject_project_client_change();
