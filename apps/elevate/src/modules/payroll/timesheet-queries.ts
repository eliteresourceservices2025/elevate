import "server-only";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { payRuns } from "./schema";
import { buildTimesheetPreview, type TimesheetPreview } from "./timesheet-import";

export type ImportPageData = {
  run: { id: string; periodStart: string; periodEnd: string; status: string };
  preview: TimesheetPreview | null;
};

/** The run and its uploaded Jibble timesheet (matched, with the amounts it would suggest), for the import page. Preparers only. */
export async function getImportPage(runId: string): Promise<ImportPageData | null> {
  const actor = await requireUser();
  await authorize(actor, "payroll.prepare");
  const [run] = await db.select({ id: payRuns.id, periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd, status: payRuns.status }).from(payRuns).where(eq(payRuns.id, runId)).limit(1);
  if (!run) return null;
  return { run, preview: run.status === "draft" ? await buildTimesheetPreview(db, runId) : null };
}
