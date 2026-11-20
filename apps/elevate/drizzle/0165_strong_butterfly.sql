CREATE TABLE "core"."dashboard_layouts" (
	"user_id" uuid NOT NULL,
	"view" text NOT NULL,
	"hidden" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_layouts_user_id_view_pk" PRIMARY KEY("user_id","view")
);
--> statement-breakpoint
ALTER TABLE "core"."dashboard_layouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "core"."birthday_preferences" (
	"employee_id" uuid PRIMARY KEY NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."birthday_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "core"."dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."birthday_preferences" ADD CONSTRAINT "birthday_preferences_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;