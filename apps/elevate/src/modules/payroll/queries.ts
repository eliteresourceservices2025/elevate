import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { clients, employees } from "@/modules/people/schema";
import type { SettingsSnapshot } from "./calculate";
import type { PaymentMethod } from "./constants";
import { lineLastDay, resolveLines } from "./lines";
import { formatPesos } from "./money";
import { payLines, paySettings } from "./schema";
import { decryptLineAmounts, payrollToday, snapshotOf } from "./service";

const today = payrollToday;
const UNREADABLE = "Can't be read";

function readableAmounts(id: string, stored: string) {
  try {
    return decryptLineAmounts(id, stored);
  } catch {
    return null;
  }
}

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
  fte: string;
  paymentMethod: PaymentMethod;
  effectiveFrom: string;
  endsOn: string | null;
  /** The date of the next version, when one is already scheduled. */
  upcomingFrom: string | null;
  /** Pesos, "31,415.92". */
  monthly: string;
  pesoAllowance: string;
  /** Dollars, "12.50". */
  dollarAllowance: string;
};

/**
 * The lines in force today, with the monthly rate and allowances decrypted for the people who can open payroll. Showing them is a
 * sensitive read: one `sensitive.view` audit row per view (field names and a count, never a figure).
 */
export async function getRates(): Promise<RateRow[]> {
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
  for (const version of [...inForce, ...notStarted]) {
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
      fte: version.fte,
      paymentMethod: version.paymentMethod as PaymentMethod,
      effectiveFrom: version.effectiveFrom,
      endsOn: lastDay,
      upcomingFrom: upcoming ?? null,
      monthly: amounts ? formatPesos(amounts.monthlyCentavos) : UNREADABLE,
      pesoAllowance: amounts ? formatPesos(amounts.pesoAllowanceCentavos) : UNREADABLE,
      dollarAllowance: amounts ? formatPesos(amounts.dollarAllowanceCents) : UNREADABLE,
    });
  }

  if (out.length > 0) {
    await writeAudit({
      actor,
      action: "sensitive.view",
      targetType: "pay_lines",
      metadata: { fields: ["monthly rate", "allowances"], count: out.length },
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
    .where(and(isNull(employees.archivedAt), eq(employees.status, "active")))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName));
  const clientRows = await db.select({ id: clients.id, name: clients.name }).from(clients).where(isNull(clients.archivedAt)).orderBy(asc(clients.name));
  return {
    people: people.map((p) => ({ id: p.id, name: `${p.preferred?.trim() || p.first} ${p.last}` })),
    clients: clientRows,
  };
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
