CREATE TABLE "chat"."guests" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"invited_by" uuid,
	"notice_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat"."guests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat"."conversations" DROP CONSTRAINT "conversations_kind_chk";--> statement-breakpoint
ALTER TABLE "core"."invitations" ADD COLUMN "guest_client_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."users" ADD COLUMN "is_guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "chat"."guests" ADD CONSTRAINT "guests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."guests" ADD CONSTRAINT "guests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."guests" ADD CONSTRAINT "guests_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guests_client_idx" ON "chat"."guests" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."invitations" ADD CONSTRAINT "invitations_guest_chk" CHECK ("core"."invitations"."guest_client_id" is null or ("core"."invitations"."roles" = '{}' and not "core"."invitations"."is_safevoice_handler"));--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_client_chk" CHECK (("chat"."conversations"."kind" = 'client') = ("chat"."conversations"."client_id" is not null));--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_kind_chk" CHECK ("chat"."conversations"."kind" in ('dm','group','team','department','company','client'));
--> statement-breakpoint
-- A guest (a client's person who may use Messages only) never holds a role, and a person is a guest from their first sign-in to the end.
CREATE FUNCTION core.guest_roles_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM core.users u WHERE u.id = NEW.user_id AND u.is_guest) THEN
    RAISE EXCEPTION 'A guest account cannot hold a role';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guest_roles_guard BEFORE INSERT OR UPDATE ON core.user_roles
  FOR EACH ROW EXECUTE FUNCTION core.guest_roles_guard();
--> statement-breakpoint
CREATE FUNCTION core.guest_flag_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_guest IS DISTINCT FROM OLD.is_guest THEN
    RAISE EXCEPTION 'users.is_guest cannot change once the account exists';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guest_flag_guard BEFORE UPDATE ON core.users
  FOR EACH ROW EXECUTE FUNCTION core.guest_flag_guard();
