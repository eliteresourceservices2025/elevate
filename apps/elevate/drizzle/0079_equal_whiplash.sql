ALTER TABLE "docs"."esign_envelopes" ADD COLUMN "signee_details" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "fills_details" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "details_enc" text;