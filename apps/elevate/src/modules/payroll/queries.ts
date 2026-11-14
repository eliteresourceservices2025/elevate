import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { users } from "@/modules/core/schema";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { clients, employees } from "@/modules/people/schema";
import type { SettingsSnapshot } from "./calculate";
import { z } from "zod";
import type { PaymentMethod, RunStatus } from "./constants";
import { lineLastDay, resolveLines } from "./lines";
import { formatPesos } from "./money";
import { countAwaiting, hashOf, latestSendBackNote, refusalFor } from "./approval";
import { readRun, worksheetOf, type Worksheet } from "./runs";
import { nextCutoff, nextStepOf, stepOf, type RunsView, type ViewerRights } from "./runs-list";
import { recentPeriods } from "@/modules/attendance/pay-periods";
import { joinAliases, personName } from "./remitly";
import { logChange } from "./changes";
import { payLines, payRunLines, payRuns, paySettings } from "./schema";
import { decryptReference, latestPayments } from "./payments";
import { decryptLineAmounts, employeeIdForUser, payrollToday, snapshotOf } from "./service";

const today = payrollToday;
const UNREADABLE = "Can't be read";

function readableAmounts(id: string, stored: string) {
  try {
    return decryptLineAmounts(id, stored);
  } catch (error) {
    // Only the line id and the kind of error: never an amount or the stored ciphertext.
    console.error("payroll rate unreadable:", { lineId: id, error: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

/** Basis points as the percent typed in the form: 12500 -> "125"; blank when not set. */
const otText = (bp: number | undefined) => (bp === undefined ? "" : formatPesos(BigInt(bp)).replace(/\.00$/, ""));

export type RateRow = {
  lineKey: string;
  employeeId: string;
  name: string;
  /** The line belongs to the viewer's own people record: they can see it but never change it. */
  isOwn: boolean;
  clientId: string | null;
  clientName: string | null;
  alias: string | null;
  hoursPerDay: number;
  paymentMethod: PaymentMethod;
  effectiveFrom: string;
  endsOn: string | null;
  /** The date of the next version, when one is already scheduled. */
  upcomingFrom: string | null;
  /** The line's last day has already passed: it is only listed when ended lines are asked for, and it can still be part of a run for an earlier period. */
  ended: boolean;
  /** Pesos, "31,415.92". */
  monthly: string;
  /** The monthly rate as whole centavos in text, for sorting; null when it can't be read. */
  monthlyCentavos: string | null;
  /** This person's own overtime percents as typed ("125"); blank means the company standard from Settings applies. */
  otPercent: { regular: string; restDay: string; restDayOver8: string };
  /** The stored amount could not be decrypted (usually a wrong or rotated encryption key). The amount above then reads "Can't be read". */
  unreadable: boolean;
};

/**
 * The lines in force today (and, when asked, the lines that already ended: a run for an earlier period still includes them), with the
 * monthly rate and allowances decrypted for the people who can open payroll. Showing them is a
 * sensitive read: one `sensitive.view` audit row per view (field names and a count, never a figure).
 */
export async function getRates(options: { includeEnded?: boolean } = {}): Promise<RateRow[]> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view");

  const rows = await db
    .select({
      line: payLines,
      first: employees.legalFirstName,
      last: employees.legalLastName,
      preferred: employees.preferredName,
      employeeUserId: employees.userId,
      clientName: clients.name,
    })
    .from(payLines)
    .innerJoin(employees, eq(employees.id, payLines.employeeId))
    .leftJoin(clients, eq(clients.id, payLines.clientId))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName), asc(payLines.effectiveFrom));

  const day = today();
  const byId = new Map(rows.map((r) => [r.line.id, r]));
  const out: RateRow[] = [];
  const all = rows.map((r) => r.line);
  const inForce = resolveLines(all, { start: day, end: day }).map((r) => r.version);
  // A line that has not started yet is still listed (with its future start date), so a Preparer can see what they added.
  const known = new Set(all.filter((l) => l.effectiveFrom <= day).map((l) => l.lineKey));
  const notStarted = [...new Set(all.map((l) => l.lineKey))]
    .filter((key) => !known.has(key))
    .map((key) => all.filter((l) => l.lineKey === key).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0))[0]);
  // Lines whose last day has passed: not in force today, but still part of any run for a period they covered. The version shown is the one
  // in force on the last day.
  const endedVersions = options.includeEnded
    ? [...new Set(all.map((l) => l.lineKey))].flatMap((key) => {
        const versions = all.filter((l) => l.lineKey === key);
        const last = lineLastDay(versions);
        if (last === null || last >= day) return [];
        const shown = versions
          .filter((l) => l.effectiveFrom <= last)
          .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.createdAt.getTime() - a.createdAt.getTime()))[0];
        return shown ? [shown] : [];
      })
    : [];
  for (const version of [...inForce, ...notStarted, ...endedVersions]) {
    const r = byId.get(version.id)!;
    // One row that cannot be read (wrong key, damaged data) must not take the whole page down: it is listed as unreadable.
    const amounts = readableAmounts(version.id, version.amountsEnc);
    const lastDay = lineLastDay(all.filter((l) => l.lineKey === version.lineKey));
    const upcoming = rows
      .filter((x) => x.line.lineKey === version.lineKey && x.line.effectiveFrom > day && (lastDay === null || x.line.effectiveFrom <= lastDay))
      .map((x) => x.line.effectiveFrom)
      .sort()[0];
    out.push({
      lineKey: version.lineKey,
      employeeId: version.employeeId,
      name: `${r.preferred?.trim() || r.first} ${r.last}`,
      isOwn: r.employeeUserId === actor.id,
      clientId: version.clientId,
      clientName: r.clientName,
      alias: version.alias,
      hoursPerDay: version.hoursPerDay,
      paymentMethod: version.paymentMethod as PaymentMethod,
      effectiveFrom: version.effectiveFrom,
      endsOn: lastDay,
      upcomingFrom: upcoming ?? null,
      ended: lastDay !== null && lastDay < day,
      monthly: amounts ? formatPesos(amounts.monthlyCentavos) : UNREADABLE,
      monthlyCentavos: amounts ? amounts.monthlyCentavos.toString() : null,
      otPercent: {
        regular: otText(amounts?.otBp?.regular),
        restDay: otText(amounts?.otBp?.restDay),
        restDayOver8: otText(amounts?.otBp?.restDayOver8),
      },
      unreadable: amounts === null,
    });
  }

  const shown = out.filter((r) => !r.unreadable).length;
  if (shown > 0) {
    await writeAudit({
      actor,
      action: "sensitive.view",
      targetType: "pay_lines",
      metadata: { fields: ["monthly rate", "allowances"], count: shown },
    });
  }
  return out;
}

export type RateOptions = {
  people: { id: string; name: string }[];
  clients: { id: string; name: string }[];
};

/** Who can be given a line, and the clients to choose from. Only a Preparer adds lines. */
export async function getRateOptions(): Promise<RateOptions> {
  const actor = await requireUser();
  await authorize(actor, "payroll.manage_rates");

  const people = await db
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
    .from(employees)
    .where(and(isNull(employees.archivedAt), ne(employees.status, "separated")))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName));
  const clientRows = await db.select({ id: clients.id, name: clients.name }).from(clients).where(isNull(clients.archivedAt)).orderBy(asc(clients.name));
  return {
    people: people.map((p) => ({ id: p.id, name: `${p.preferred?.trim() || p.first} ${p.last}` })),
    clients: clientRows,
  };
}

export type RunListRow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: RunStatus;
  lineCount: number;
  createdAt: string;
  isTest: boolean;
  peopleCount: number;
  paidCount: number;
  released: boolean;
  /** 1 to 4 (prepared, in review, approved, paid); 0 for a cancelled run. */
  step: 0 | 1 | 2 | 3 | 4;
  /** What this viewer does next (or is waiting for), and whether the action is theirs. Null when there is nothing to say. */
  nextStep: { label: string; mine: boolean } | null;
};

export type RunsSummary = {
  /** The oldest recent cutoff with no real run yet, or null when every recent cutoff has one. */
  nextCutoff: { start: string; end: string; daysLeft: number } | null;
  inReview: number;
  /** The newest real run that is approved and not fully paid. */
  approvedNotPaid: { count: number; periodStart: string; periodEnd: string; paidCount: number; peopleCount: number } | null;
  lastPaid: { periodStart: string; periodEnd: string; peopleCount: number } | null;
};

const PEOPLE = (run: ReturnType<typeof sql>) => sql<number>`(select count(distinct l.employee_id)::int from payroll.pay_run_lines l where l.run_id = ${run} and not l.excluded)`;
const PAID = (run: ReturnType<typeof sql>) => sql<number>`(select count(distinct p.employee_id)::int from payroll.pay_payments p where p.run_id = ${run})`;

/**
 * One page of runs, newest period first, with the people and payments counted, the step each run is at and what this viewer does next.
 * Archived runs (test runs and cancelled runs) are left out unless `archived` is true. `view` narrows the list to the runs that need this
 * viewer ("action") or to test runs. Also returns the summary tiles (real runs only). Counts and dates, never a figure.
 */
export async function getRuns(
  paging: { page: number; pageSize: number },
  options: { archived?: boolean; view?: RunsView } = {},
): Promise<{ rows: RunListRow[]; total: number; archivedCount: number; showingArchived: boolean; canPrepare: boolean; canPurge: boolean; view: RunsView; actionCount: number; summary: RunsSummary }> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view");

  const rights: ViewerRights = { prepare: can(actor, "payroll.prepare"), approve: can(actor, "payroll.approve"), markPaid: can(actor, "payroll.mark_paid"), release: can(actor, "payroll.release_statements") };
  const showingArchived = options.archived === true;
  const view = showingArchived ? "all" : (options.view ?? "all");
  const released = sql<boolean>`exists (select 1 from payroll.pay_run_releases rr where rr.run_id = ${payRuns.id})`;
  // The runs that wait for this viewer: a draft for a Preparer, a run in review for an Approver, an approved run for someone who pays, a paid real run nobody has released yet.
  const mine = or(
    rights.prepare ? eq(payRuns.status, "draft") : undefined,
    rights.approve ? eq(payRuns.status, "in_review") : undefined,
    rights.markPaid ? eq(payRuns.status, "approved") : undefined,
    rights.release ? and(eq(payRuns.status, "paid"), eq(payRuns.isTest, false), sql`not ${released}`) : undefined,
  );
  const base = showingArchived ? isNotNull(payRuns.archivedAt) : isNull(payRuns.archivedAt);
  const shown = view === "test" ? and(base, eq(payRuns.isTest, true)) : view === "action" ? and(base, mine ?? sql`false`) : base;

  const [{ total }] = await db.select({ total: count() }).from(payRuns).where(shown);
  const [{ archivedCount }] = await db.select({ archivedCount: count() }).from(payRuns).where(isNotNull(payRuns.archivedAt));
  const [{ actionCount }] = await db.select({ actionCount: count() }).from(payRuns).where(and(isNull(payRuns.archivedAt), mine ?? sql`false`));
  const rows = await db
    .select({
      id: payRuns.id,
      periodStart: payRuns.periodStart,
      periodEnd: payRuns.periodEnd,
      status: payRuns.status,
      isTest: payRuns.isTest,
      createdAt: payRuns.createdAt,
      lineCount: sql<number>`(select count(*)::int from payroll.pay_run_lines l where l.run_id = ${payRuns.id})`,
      peopleCount: PEOPLE(sql`${payRuns.id}`),
      paidCount: PAID(sql`${payRuns.id}`),
      released,
    })
    .from(payRuns)
    .where(shown)
    .orderBy(desc(payRuns.periodStart), desc(payRuns.createdAt))
    .limit(paging.pageSize)
    .offset((paging.page - 1) * paging.pageSize);

  // The tiles: real runs only (a practice run never counts), nothing archived or cancelled.
  const recent = recentPeriods("semi_monthly", today(), 3);
  const real = and(eq(payRuns.isTest, false), isNull(payRuns.archivedAt), ne(payRuns.status, "cancelled"));
  const realRuns = await db
    .select({ start: payRuns.periodStart })
    .from(payRuns)
    .where(and(real, inArray(payRuns.periodStart, recent.map((p) => p.start))));
  const [{ inReview }] = await db.select({ inReview: count() }).from(payRuns).where(and(real, eq(payRuns.status, "in_review")));
  const [approved] = await db
    .select({ periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd, peopleCount: PEOPLE(sql`${payRuns.id}`), paidCount: PAID(sql`${payRuns.id}`) })
    .from(payRuns)
    .where(and(real, eq(payRuns.status, "approved")))
    .orderBy(desc(payRuns.periodStart))
    .limit(1);
  const [{ approvedCount }] = await db.select({ approvedCount: count() }).from(payRuns).where(and(real, eq(payRuns.status, "approved")));
  const [paid] = await db
    .select({ periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd, peopleCount: PEOPLE(sql`${payRuns.id}`) })
    .from(payRuns)
    .where(and(real, eq(payRuns.status, "paid")))
    .orderBy(desc(payRuns.periodStart))
    .limit(1);

  return {
    rows: rows.map((r) => {
      const status = r.status as RunStatus;
      return {
        id: r.id,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        status,
        lineCount: r.lineCount,
        createdAt: r.createdAt.toISOString(),
        isTest: r.isTest,
        peopleCount: r.peopleCount,
        paidCount: r.paidCount,
        released: r.released,
        step: stepOf(status),
        nextStep: nextStepOf({ status, isTest: r.isTest, peopleCount: r.peopleCount, paidCount: r.paidCount, released: r.released }, rights),
      };
    }),
    total,
    archivedCount,
    showingArchived,
    canPrepare: rights.prepare,
    canPurge: can(actor, "payroll.purge_archived"),
    view,
    actionCount,
    summary: {
      nextCutoff: nextCutoff(recent, new Set(realRuns.map((r) => r.start)), today()),
      inReview,
      approvedNotPaid: approved ? { count: approvedCount, periodStart: approved.periodStart, periodEnd: approved.periodEnd, paidCount: approved.paidCount, peopleCount: approved.peopleCount } : null,
      lastPaid: paid ?? null,
    },
  };
}

export type WorksheetView = Worksheet & {
  canPrepare: boolean;
  canApprove: boolean;
  /** Only for an Approver looking at a run in review: the hash of exactly the figures shown, which an approval must name. */
  expectedHash: string | null;
  /** Only for an Approver looking at a run in review: why they may not approve it, or null when they may. */
  approvalRefusal: string | null;
  /** The note of the latest send-back, while the run is back in draft. */
  sentBackNote: string | null;
};

/**
 * The worksheet of a run, decrypted, or null when there is no such run. Opening it is a sensitive read: one `sensitive.view` audit row
 * per call (ids and a count, never a figure) and at most one change-log view row per person, run and day.
 */
export async function getWorksheet(runId: string): Promise<WorksheetView | null> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view");
  if (!z.uuid().safeParse(runId).success) return null;
  const canPrepare = can(actor, "payroll.prepare");
  const canApprove = can(actor, "payroll.approve");

  // One snapshot: the figures shown and the hash handed to an Approver come from the same reads, so the hash can never stand for
  // figures the page did not show.
  const view = await db.transaction(
    async (tx): Promise<WorksheetView | null> => {
      const data = await readRun(tx, runId);
      if (!data) return null;
      const sheet = await worksheetOf(tx, { id: actor.id, canPrepare }, data);
      const deciding = canApprove && data.run.status === "in_review";
      return {
        ...sheet,
        canPrepare,
        canApprove,
        expectedHash: deciding ? await hashOf(tx, data) : null,
        approvalRefusal: deciding ? await refusalFor(tx, data, actor.id) : null,
        sentBackNote: await latestSendBackNote(tx, data.run),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (!view) return null;
  await db.transaction(async (tx) => {
    await writeAudit({ actor, action: "sensitive.view", targetType: "pay_run", targetId: runId, metadata: { fields: ["pay figures"], count: view.lines.length } }, tx);
    await logChange(tx, actor, { action: "run_viewed", runId });
  });
  return view;
}

export type PaymentsView = {
  runId: string;
  status: RunStatus;
  isTest: boolean;
  canMarkPaid: boolean;
  canExport: boolean;
  people: {
    employeeId: string;
    name: string;
    aliases: string;
    isOwn: boolean;
    /** `reference` is null unless the viewer holds `payroll.mark_paid`: others see who marked it and when, not the reference. */
    payment: { reference: string | null; paidOn: string; markedBy: string; markedAt: string } | null;
  }[];
};

/**
 * Who is paid on a run. Transfer references are decrypted only for people who hold `payroll.mark_paid`; that is a sensitive read, so
 * it writes one `sensitive.view` audit row (field name and a count of references actually decrypted, never a reference) and none when
 * nothing was decrypted. Everyone else sees who marked each payment and when.
 */
export async function getPayments(runId: string): Promise<PaymentsView | null> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view");
  if (!z.uuid().safeParse(runId).success) return null;
  const canMarkPaid = can(actor, "payroll.mark_paid");

  let decrypted = 0;
  const view = await db.transaction(async (tx): Promise<PaymentsView | null> => {
    const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId)).limit(1);
    if (!run) return null;
    const lines = await tx
      .select({ employeeId: payRunLines.employeeId, alias: payRunLines.alias, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
      .from(payRunLines)
      .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
      .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false)))
      .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName), asc(payRunLines.alias));
    const own = await employeeIdForUser(tx, actor.id);
    const paid = await latestPayments(tx, runId);
    const markers = new Map(
      (paid.size === 0 ? [] : await tx.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, [...new Set([...paid.values()].map((p) => p.markedBy))]))).map((u) => [u.id, u.email]),
    );

    const byPerson = new Map<string, { name: string; aliases: (string | null)[] }>();
    for (const l of lines) {
      const person = byPerson.get(l.employeeId) ?? { name: personName(l), aliases: [] };
      person.aliases.push(l.alias);
      byPerson.set(l.employeeId, person);
    }
    const people = [...byPerson].map(([employeeId, person]): PaymentsView["people"][number] => {
      const p = paid.get(employeeId);
      let payment: PaymentsView["people"][number]["payment"] = null;
      if (p) {
        let reference: string | null = null;
        if (canMarkPaid) {
          try {
            reference = decryptReference(p.id, p.referenceEnc);
          } catch (error) {
            console.error("payroll payment reference unreadable:", { paymentId: p.id, error: error instanceof Error ? error.name : "UnknownError" });
            reference = UNREADABLE;
          }
          decrypted += 1;
        }
        payment = { reference, paidOn: p.paidOn, markedBy: markers.get(p.markedBy) ?? "Unknown", markedAt: p.createdAt.toISOString() };
      }
      return { employeeId, name: person.name, aliases: joinAliases(person.aliases), isOwn: own !== null && own === employeeId, payment };
    });
    return { runId, status: run.status as RunStatus, isTest: run.isTest, canMarkPaid, canExport: can(actor, "payroll.export"), people };
  });
  if (view && decrypted > 0) await writeAudit({ actor, action: "sensitive.view", targetType: "pay_run", targetId: runId, metadata: { fields: ["payment references"], count: decrypted } });
  return view;
}

/** How many runs in review this Approver could decide (none they prepared or changed). A count only, for the dashboard. */
export async function payrollRunsAwaitingApproval(): Promise<number> {
  const actor = await requireUser();
  await authorize(actor, "payroll.approve");
  return countAwaiting(db, actor.id);
}

export type SettingsVersion = SettingsSnapshot & { effectiveFrom: string };

export type PaySettingsView = {
  /** In force today; null when no version is dated today or earlier. */
  current: SettingsVersion | null;
  /** Every version, newest first. */
  history: SettingsVersion[];
  canManage: boolean;
};

export async function getPaySettings(): Promise<PaySettingsView> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view");

  const rows = await db.select().from(paySettings).orderBy(desc(paySettings.effectiveFrom), desc(paySettings.createdAt));
  const history = rows.map((r) => ({ effectiveFrom: r.effectiveFrom, ...snapshotOf(r) }));
  // Newest first, so the first version dated today or earlier is the one in force (the same rule as settingsInForce).
  const current = history.find((h) => h.effectiveFrom <= today()) ?? null;
  return { current, history, canManage: can(actor, "payroll.manage_rates") };
}
