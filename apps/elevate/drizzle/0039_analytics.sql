CREATE TABLE "ops"."analytics_attendance_weekly" (
	"week_start" date NOT NULL,
	"dim_kind" text NOT NULL,
	"dim_id" uuid NOT NULL,
	"day_count" integer NOT NULL,
	"late" integer NOT NULL,
	"absent" integer NOT NULL,
	"left_early" integer NOT NULL,
	"extra_hours" integer NOT NULL,
	"unapproved_extra" integer NOT NULL,
	"group_size" integer NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_attendance_weekly_week_start_dim_kind_dim_id_pk" PRIMARY KEY("week_start","dim_kind","dim_id"),
	CONSTRAINT "analytics_attendance_kind_chk" CHECK (dim_kind in ('company','team','client','downline'))
);
--> statement-breakpoint
ALTER TABLE "ops"."analytics_attendance_weekly" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."analytics_funnel_monthly" (
	"month" date NOT NULL,
	"opening_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"applications" integer NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_funnel_monthly_month_opening_id_stage_pk" PRIMARY KEY("month","opening_id","stage")
);
--> statement-breakpoint
ALTER TABLE "ops"."analytics_funnel_monthly" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."analytics_headcount_daily" (
	"date" date NOT NULL,
	"dim_kind" text NOT NULL,
	"dim_id" uuid NOT NULL,
	"headcount" integer NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_headcount_daily_date_dim_kind_dim_id_pk" PRIMARY KEY("date","dim_kind","dim_id"),
	CONSTRAINT "analytics_headcount_kind_chk" CHECK (dim_kind in ('company','team','client','downline'))
);
--> statement-breakpoint
ALTER TABLE "ops"."analytics_headcount_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."analytics_leave_monthly" (
	"month" date NOT NULL,
	"dim_kind" text NOT NULL,
	"dim_id" uuid NOT NULL,
	"days_used" numeric(9, 2) NOT NULL,
	"group_size" integer NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_leave_monthly_month_dim_kind_dim_id_pk" PRIMARY KEY("month","dim_kind","dim_id"),
	CONSTRAINT "analytics_leave_kind_chk" CHECK (dim_kind in ('company','team','client','downline'))
);
--> statement-breakpoint
ALTER TABLE "ops"."analytics_leave_monthly" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."analytics_movement_monthly" (
	"month" date NOT NULL,
	"dim_kind" text NOT NULL,
	"dim_id" uuid NOT NULL,
	"joiners" integer NOT NULL,
	"leavers" integer NOT NULL,
	"avg_headcount" numeric(9, 2) NOT NULL,
	"end_headcount" integer NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_movement_monthly_month_dim_kind_dim_id_pk" PRIMARY KEY("month","dim_kind","dim_id"),
	CONSTRAINT "analytics_movement_kind_chk" CHECK (dim_kind in ('company','team','client','downline'))
);
--> statement-breakpoint
ALTER TABLE "ops"."analytics_movement_monthly" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."analytics_time_to_hire_monthly" (
	"month" date NOT NULL,
	"opening_id" uuid NOT NULL,
	"hires" integer NOT NULL,
	"total_days" numeric(10, 2) NOT NULL,
	"median_days" numeric(8, 2) NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_time_to_hire_monthly_month_opening_id_pk" PRIMARY KEY("month","opening_id")
);
--> statement-breakpoint
ALTER TABLE "ops"."analytics_time_to_hire_monthly" ENABLE ROW LEVEL SECURITY;