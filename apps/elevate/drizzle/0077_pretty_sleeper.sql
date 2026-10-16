ALTER TABLE "docs"."esign_envelopes" ADD COLUMN "initial_each_page" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "initials_text" text;--> statement-breakpoint
ALTER TABLE "docs"."esign_signers" ADD COLUMN "initialed_pages" smallint;