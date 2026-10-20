CREATE TABLE "talent"."candidate_self_identification" (
	"candidate_id" uuid PRIMARY KEY NOT NULL,
	"gender" text,
	"gender_other_enc" text,
	"religion_enc" text,
	"religion_other_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_self_identification_gender_chk" CHECK ("talent"."candidate_self_identification"."gender" is null or "talent"."candidate_self_identification"."gender" in ('woman','man','non_binary','self_described','prefer_not_to_say'))
);
--> statement-breakpoint
ALTER TABLE "talent"."candidate_self_identification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."employee_demographics" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"gender" text,
	"gender_other_enc" text,
	"pronouns" text,
	"pronouns_other" text,
	"religion_enc" text,
	"religion_other_enc" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_demographics_gender_chk" CHECK ("core"."employee_demographics"."gender" is null or "core"."employee_demographics"."gender" in ('woman','man','non_binary','self_described','prefer_not_to_say')),
	CONSTRAINT "employee_demographics_pronouns_chk" CHECK ("core"."employee_demographics"."pronouns" is null or "core"."employee_demographics"."pronouns" in ('she_her','he_him','they_them','she_they','he_they','ask_me','self_described','prefer_not_to_say'))
);
--> statement-breakpoint
ALTER TABLE "core"."employee_demographics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "talent"."candidate_self_identification" ADD CONSTRAINT "candidate_self_identification_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "talent"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."employee_demographics" ADD CONSTRAINT "employee_demographics_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;