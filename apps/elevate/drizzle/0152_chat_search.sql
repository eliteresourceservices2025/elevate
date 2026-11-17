CREATE TABLE "chat"."search_tokens" (
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"token" text NOT NULL,
	CONSTRAINT "search_tokens_message_id_token_pk" PRIMARY KEY("message_id","token")
);
--> statement-breakpoint
ALTER TABLE "chat"."search_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat"."search_tokens" ADD CONSTRAINT "search_tokens_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."search_tokens" ADD CONSTRAINT "search_tokens_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_tokens_lookup_idx" ON "chat"."search_tokens" USING btree ("conversation_id","token","message_id");