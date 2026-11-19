ALTER TABLE "payroll"."pay_payments" ADD COLUMN "sent_time" time;--> statement-breakpoint
ALTER TABLE "payroll"."pay_payments" ADD COLUMN "expected_on" date;--> statement-breakpoint
ALTER TABLE "payroll"."pay_payments" ADD COLUMN "expected_time" time;