ALTER TABLE "chat"."conversations" DROP CONSTRAINT "conversations_kind_chk";--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD COLUMN "posting" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "core"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_team_idx" ON "chat"."conversations" USING btree ("team_id") WHERE "chat"."conversations"."team_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_department_idx" ON "chat"."conversations" USING btree ("department_id") WHERE "chat"."conversations"."department_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_company_idx" ON "chat"."conversations" USING btree ("kind") WHERE "chat"."conversations"."kind" = 'company';--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_posting_chk" CHECK ("chat"."conversations"."posting" in ('everyone','admins'));--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_kind_chk" CHECK ("chat"."conversations"."kind" in ('dm','group','team','department','company'));