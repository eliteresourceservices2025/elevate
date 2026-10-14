CREATE TABLE "ops"."schedule_import_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"sheet_key" text NOT NULL,
	"employee_id" uuid,
	"client_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_import_aliases_kind_chk" CHECK ("ops"."schedule_import_aliases"."kind" in ('person','client')),
	CONSTRAINT "schedule_import_aliases_target_chk" CHECK (("ops"."schedule_import_aliases"."kind" = 'person' and "ops"."schedule_import_aliases"."employee_id" is not null and "ops"."schedule_import_aliases"."client_id" is null) or ("ops"."schedule_import_aliases"."kind" = 'client' and "ops"."schedule_import_aliases"."client_id" is not null and "ops"."schedule_import_aliases"."employee_id" is null))
);
--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."schedule_import_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"header_key" text NOT NULL,
	"columns" jsonb NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_layouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_aliases" ADD CONSTRAINT "schedule_import_aliases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "core"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_aliases" ADD CONSTRAINT "schedule_import_aliases_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "core"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_aliases" ADD CONSTRAINT "schedule_import_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."schedule_import_layouts" ADD CONSTRAINT "schedule_import_layouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_import_aliases_key_idx" ON "ops"."schedule_import_aliases" USING btree ("kind","sheet_key");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_import_layouts_header_idx" ON "ops"."schedule_import_layouts" USING btree ("header_key");