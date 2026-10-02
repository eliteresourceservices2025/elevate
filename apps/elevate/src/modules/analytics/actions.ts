"use server";

import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { dashboardCsv } from "./export";
import { getDashboard } from "./queries";
import { exportAnalyticsSchema } from "./validators";

// Export of the displayed aggregates (HR and Super Admin only). The file holds exactly what the dashboard shows: hidden cells stay hidden.

/** A CSV of the dashboard for the chosen range and group. Audited as analytics.export, rate-limited like the hours export. */
export async function exportAnalytics(input: unknown): Promise<ActionResult<{ fileName: string; csv: string; rows: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "analytics.export");
    const parsed = exportAnalyticsSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the request and try again.");
    if (!(await allowRequest("download", actor.id))) return fail("Too many exports. Wait a few minutes and try again.");
    const dashboard = await getDashboard({ range: parsed.data.range, scope: parsed.data.scope });
    const built = dashboardCsv(dashboard);
    await writeAudit({ actor, action: "analytics.export", targetType: "analytics", targetId: undefined, metadata: { rangeMonths: parsed.data.range, scope: dashboard.scope.value, rows: built.rows } });
    return { ok: true, data: { fileName: `people-analytics-${dashboard.asOf ?? "none"}-${parsed.data.range}m.csv`, csv: built.csv, rows: built.rows } };
  });
}
