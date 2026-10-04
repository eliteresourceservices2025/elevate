import "server-only";
import { and, count, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PLACEHOLDER_MARK } from "@/modules/announcements/constants";
import { policies, policyVersions } from "@/modules/announcements/schema";
import { users } from "@/modules/core/schema";
import { employees } from "@/modules/people/schema";
import { envProblems, MANUAL_STEPS } from "./golive";
import { goLiveItems, importBatches } from "./schema";

export type GoLiveRow = { key: string; title: string; detail: string; kind: "auto" | "manual"; done: boolean; note: string | null; doneAt: Date | null };

async function publishedReal(kind: "privacy_notice" | "monitoring") {
  const rows = await db
    .select({ body: policyVersions.body })
    .from(policyVersions)
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(and(eq(policies.kind, kind), isNull(policies.archivedAt), eq(policyVersions.status, "published")));
  return rows.some((r) => !r.body.includes(PLACEHOLDER_MARK));
}

/** The checklist: automatic checks computed from this system, then the manual steps HR ticks. HR and Super Admin only. */
export async function getGoLive(): Promise<{ rows: GoLiveRow[]; envMissing: string[]; notProduction: boolean }> {
  const user = await requireUser();
  await authorize(user, "imports.manage");
  const env = envProblems(process.env);
  const [handlers] = await db.select({ n: count() }).from(users).where(and(eq(users.isSafevoiceHandler, true), isNull(users.archivedAt)));
  const [signed] = await db.select({ n: count() }).from(importBatches).where(and(eq(importBatches.status, "committed"), isNotNull(importBatches.signedOffAt)));
  const [current] = await db.select({ n: count() }).from(employees).where(and(isNull(employees.archivedAt), ne(employees.status, "separated")));
  const [withAccount] = await db.select({ n: count() }).from(employees).where(and(isNull(employees.archivedAt), ne(employees.status, "separated"), isNotNull(employees.userId)));
  const [privacy, monitoring] = [await publishedReal("privacy_notice"), await publishedReal("monitoring")];
  const saved = await db.select().from(goLiveItems);
  const byKey = new Map(saved.map((s) => [s.key, s]));

  const auto: GoLiveRow[] = [
    { key: "auto_env", title: "Production settings are in place", detail: env.missing.length ? `Missing here: ${env.missing.join(", ")}.` : "Every required setting has a value (values are never shown).", kind: "auto", done: env.missing.length === 0 && !env.notProduction, note: env.notProduction ? "This is not the production deployment (ELEVATE_ENV is not production), so check there too." : null, doneAt: null },
    { key: "auto_privacy", title: "The privacy notice is published (real text, not the draft placeholder)", detail: "People must accept it before they use ELEVATE.", kind: "auto", done: privacy, note: null, doneAt: null },
    { key: "auto_monitoring", title: "The monitoring policy is published", detail: "Needed before the time clock uses screenshots, location or selfies.", kind: "auto", done: monitoring, note: null, doneAt: null },
    { key: "auto_handlers", title: "At least two Safe Voice handlers are named", detail: `${handlers.n} named. Two means one absence never leaves reports unread.`, kind: "auto", done: handlers.n >= 2, note: null, doneAt: null },
    { key: "auto_reconciled", title: "A TalentHR import is reconciled and signed off", detail: signed.n > 0 ? `${signed.n} signed off.` : "Commit an import, then sign off its reconciliation.", kind: "auto", done: signed.n > 0, note: null, doneAt: null },
    { key: "auto_accounts", title: "People have accounts", detail: `${withAccount.n} of ${current.n} current people have signed up. Send invitations in waves.`, kind: "auto", done: current.n > 0 && withAccount.n === current.n, note: null, doneAt: null },
  ];
  const manual: GoLiveRow[] = MANUAL_STEPS.map((s) => {
    const row = byKey.get(s.key);
    return { key: s.key, title: s.title, detail: s.detail, kind: "manual", done: Boolean(row), note: row?.note ?? null, doneAt: row?.doneAt ?? null };
  });
  return { rows: [...auto, ...manual], envMissing: env.missing, notProduction: env.notProduction };
}
