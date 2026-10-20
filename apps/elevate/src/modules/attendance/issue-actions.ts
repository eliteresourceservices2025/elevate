"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { reportName, timeChainUserIds } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { correctionEvidence, ISSUE_KINDS, techIssueReports } from "./schema";
import { personForUser, verifyEvidence } from "./service";
import { EVIDENCE_MAX_BYTES } from "./validators";
import { ISSUE_KIND_LABELS } from "./issue-labels";

// Technical issue reports: a contractor tells their lead and HR the clock or Jibble (or their connection or device) failed. A report
// is only a report: it never adds, changes or removes a clock event or any hours (a missed time is a correction request).

const BAD = "Check the request and try again.";
const DAY_MS = 86_400_000;
const MAX_OPEN = 5;

const reportSchema = z.object({
  kind: z.enum(ISSUE_KINDS),
  happenedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter when it started"),
  details: z.string().trim().min(5, "Say what happened in a few words").max(1000, "Use 1000 characters or fewer"),
  /** Screenshots uploaded with requestEvidenceUpload: at least one, to show what happened (an error message, Jibble still running). */
  evidenceIds: z.array(z.uuid()).min(1, "Attach a screenshot that shows the problem").max(3, "Attach three screenshots at most"),
});
const handleSchema = z.object({ issueId: z.uuid(), note: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(500).optional()) });

function refresh() {
  revalidatePath("/attendance");
}

/** The signed-in person reports a technical issue. The lead (and HR) are told. Needs no particular clock state. */
export async function reportTechIssue(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "attendance.report_issue", { ownerUserId: actor.id });
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? BAD);
    const { kind, details, evidenceIds } = parsed.data;
    const happenedAt = new Date(parsed.data.happenedAt);
    const now = Date.now();
    if (happenedAt.getTime() > now + 5 * 60_000) return fail("That time is in the future.");
    if (happenedAt.getTime() < now - 31 * DAY_MS) return fail("Report a problem within 31 days of when it happened.");

    const person = await personForUser(db, actor.id);
    const hrIds = await hrUserIds();
    await db.transaction(async (tx) => {
      const [{ n }] = (await tx.execute(sql`select count(*)::int as n from time.tech_issue_reports where employee_id = ${person.id} and status = 'open'`)) as unknown as { n: number }[];
      if (n >= MAX_OPEN) throw new ActionFailure(`You already have ${MAX_OPEN} reports waiting. They will be answered soon.`);
      const [row] = await tx.insert(techIssueReports).values({ employeeId: person.id, reportedBy: actor.id, kind, happenedAt, details }).returning({ id: techIssueReports.id });
      const attached = await verifyEvidence(tx, person.id, evidenceIds, EVIDENCE_MAX_BYTES, actor.id);
      if (attached.length > 0) await tx.update(correctionEvidence).set({ issueId: row.id }).where(inArray(correctionEvidence.id, attached));
      const [me] = await tx.select({ first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName }).from(employees).where(eq(employees.id, person.id));
      const chain = await timeChainUserIds(tx, person.id);
      const targets = [...new Set([...chain.slice(0, 1), ...hrIds])].filter((id) => id !== actor.id);
      await notify(tx, targets.map((userId) => ({ userId, kind: "attendance.issue_reported", title: `${reportName(me)} reported a technical issue`, body: ISSUE_KIND_LABELS[kind], link: "/attendance?tab=issues" })));
      await writeAudit({ actor, action: "clock.issue_report", targetType: "employee", targetId: person.id, metadata: { issueId: row.id, kind, screenshots: attached.length } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** A lead (for their people) or HR marks a report as handled, with an optional note the person sees. Nobody handles their own. */
export async function handleTechIssue(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = handleSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const { issueId, note } = parsed.data;
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(techIssueReports).where(eq(techIssueReports.id, issueId)).for("update");
      if (!r) throw new ActionFailure("That report was not found.");
      if (r.status !== "open") throw new ActionFailure("That report was already handled.");
      const [person] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, r.employeeId));
      if (person?.userId === actor.id || r.reportedBy === actor.id) throw new ActionFailure("Someone else must handle your own report.");
      await authorize(actor, "attendance.handle_issue", { ownerUserId: person?.userId ?? undefined, managerChainUserIds: await timeChainUserIds(tx, r.employeeId) });
      await tx.update(techIssueReports).set({ status: "handled", handledBy: actor.id, handledAt: new Date(), handlingNote: note ?? null }).where(and(eq(techIssueReports.id, issueId), eq(techIssueReports.status, "open")));
      if (person?.userId) await notify(tx, { userId: person.userId, kind: "attendance.issue_handled", title: "Your technical issue report was handled", body: note, link: "/attendance?tab=issues" });
      await writeAudit({ actor, action: "clock.issue_handled", targetType: "employee", targetId: r.employeeId, metadata: { issueId, withNote: Boolean(note) } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}
