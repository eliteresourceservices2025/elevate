import { integer, text, timestamp } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";

// System health: every scheduled job checks in when it runs, so a job that stops (the job service is down, a limit is hit)
// is noticed instead of failing silently. Only the job name, times and a short error name are stored: no data from the job.

export const jobRuns = ops
  .table("job_runs", {
    job: text("job").primaryKey(),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    /** The error's class name only, never its message (which could hold request data). */
    lastError: text("last_error"),
    runs: integer("runs").notNull().default(0),
  })
  .enableRLS();
