CREATE TABLE "chat"."poll_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"label_enc" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."poll_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."poll_votes" (
	"message_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_option_id_user_id_pk" PRIMARY KEY("option_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "chat"."poll_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat"."polls" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."polls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat"."poll_options" ADD CONSTRAINT "poll_options_message_id_polls_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."polls"("message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."poll_votes" ADD CONSTRAINT "poll_votes_message_id_polls_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."polls"("message_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."poll_votes" ADD CONSTRAINT "poll_votes_option_id_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "chat"."poll_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."polls" ADD CONSTRAINT "polls_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_options_position_idx" ON "chat"."poll_options" USING btree ("message_id","position");--> statement-breakpoint
CREATE INDEX "poll_votes_message_idx" ON "chat"."poll_votes" USING btree ("message_id","user_id");