ALTER TABLE "talent"."candidate_self_identification" DROP CONSTRAINT "candidate_self_identification_gender_chk";--> statement-breakpoint
ALTER TABLE "core"."employee_demographics" DROP CONSTRAINT "employee_demographics_gender_chk";--> statement-breakpoint
ALTER TABLE "talent"."candidate_self_identification" ADD COLUMN "sexual_orientation_enc" text;--> statement-breakpoint
ALTER TABLE "talent"."candidate_self_identification" ADD COLUMN "sexual_orientation_other_enc" text;--> statement-breakpoint
ALTER TABLE "core"."employee_demographics" ADD COLUMN "sexual_orientation_enc" text;--> statement-breakpoint
ALTER TABLE "core"."employee_demographics" ADD COLUMN "sexual_orientation_other_enc" text;--> statement-breakpoint
ALTER TABLE "core"."employee_demographics" ADD COLUMN "show_gender" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."employee_demographics" ADD COLUMN "show_orientation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."employee_demographics" ADD COLUMN "show_religion" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "talent"."candidate_self_identification" ADD CONSTRAINT "candidate_self_identification_gender_chk" CHECK ("talent"."candidate_self_identification"."gender" is null or "talent"."candidate_self_identification"."gender" in ('woman','man','trans_woman','trans_man','non_binary','self_described','prefer_not_to_say'));--> statement-breakpoint
ALTER TABLE "core"."employee_demographics" ADD CONSTRAINT "employee_demographics_gender_chk" CHECK ("core"."employee_demographics"."gender" is null or "core"."employee_demographics"."gender" in ('woman','man','trans_woman','trans_man','non_binary','self_described','prefer_not_to_say'));