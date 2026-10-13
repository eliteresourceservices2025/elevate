-- A new automatic checklist check: "HIPAA training is passed" (ticked by ELEVATE when the person holds a current ELEVATE Learn
-- certificate for the HIPAA course). Templates may use it for onboarding.
ALTER TABLE "talent"."checklist_template_items" DROP CONSTRAINT "checklist_template_items_check_chk";--> statement-breakpoint
ALTER TABLE "talent"."checklist_template_items" ADD CONSTRAINT "checklist_template_items_check_chk" CHECK ("talent"."checklist_template_items"."check_kind" in ('manual','document','required_documents','policy','account','signature','exit_interview','access','assets_returned','hipaa_training'));
