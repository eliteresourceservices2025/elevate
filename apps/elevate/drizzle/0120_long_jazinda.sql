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
ALTER TABLE "core"."dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;