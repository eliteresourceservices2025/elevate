import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { peopleByUserId } from "@/modules/messages/queries";
import { callSettings, calls, callUsage } from "./schema";
import { callsAvailable, fakeCallsEnabled } from "./sfu-port";
import { overWarning } from "./usage";

// Call settings and the monthly media estimate, for Super Admins. The estimate is ours (participant-minutes times a typical bitrate); the
// real figure is in Cloudflare's dashboard, and this page says so. Nothing here lists who was in a call or what was said.

export type CallSettingsView = {
  /** Calls work (Cloudflare is set up, or the test fake is on). */
  available: boolean;
  usingFake: boolean;
  monthGb: number;
  freeGb: number;
  warningGb: number;
  overWarning: boolean;
  callsThisMonth: number;
  participantMinutesThisMonth: number;
  townhallEnabled: boolean;
  recordingEnabled: boolean;
  /** People a Super Admin picked to record calls, and everyone else who could be picked. */
  recorders: { id: string; name: string }[];
  candidates: { id: string; name: string }[];
  recent: { id: string; startedAt: string; minutes: number; people: number; estimatedGb: number; endReason: string | null }[];
};

export const FREE_GB = 1000;

export async function getCallSettingsView(): Promise<CallSettingsView> {
  const actor = await requireUser();
  await authorize(actor, "calls.settings");
  const [settings] = await db.select().from(callSettings).where(eq(callSettings.id, 1)).limit(1);
  const monthStart = sql`date_trunc('month', now() at time zone 'utc')`;
  const [month] = await db
    .select({
      gb: sql<string>`coalesce(sum(${callUsage.estimatedGb}), 0)`,
      minutes: sql<number>`coalesce(sum(${callUsage.participantMinutes}), 0)::int`,
      n: sql<number>`count(*)::int`,
    })
    .from(callUsage)
    .innerJoin(calls, eq(calls.id, callUsage.callId))
    .where(gte(calls.startedAt, sql`${monthStart} at time zone 'utc'`));
  const recent = await db
    .select({ id: calls.id, startedAt: calls.startedAt, endedAt: calls.endedAt, endReason: calls.endReason, people: calls.maxParticipants, gb: callUsage.estimatedGb })
    .from(calls)
    .leftJoin(callUsage, eq(callUsage.callId, calls.id))
    .orderBy(desc(calls.startedAt))
    .limit(10);
  const staff = await db.select({ id: users.id, can: users.canRecordCalls }).from(users).where(and(eq(users.isGuest, false), isNull(users.archivedAt))).limit(400);
  const names = await peopleByUserId(staff.map((u) => u.id));
  const named = staff.map((u) => ({ id: u.id, name: names.get(u.id)?.name ?? "", can: u.can })).filter((u) => u.name);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const monthGb = Number(month.gb);
  const warningGb = settings?.monthlyGbWarning ?? 700;
  return {
    available: callsAvailable(),
    usingFake: fakeCallsEnabled(),
    monthGb,
    freeGb: FREE_GB,
    warningGb,
    overWarning: overWarning(monthGb, warningGb),
    callsThisMonth: month.n,
    participantMinutesThisMonth: month.minutes,
    townhallEnabled: settings?.townhallEnabled ?? true,
    recordingEnabled: settings?.recordingEnabled ?? false,
    recorders: named.filter((u) => u.can).sort(byName).map(({ id, name }) => ({ id, name })),
    candidates: named.filter((u) => !u.can).sort(byName).map(({ id, name }) => ({ id, name })),
    recent: recent.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      minutes: r.endedAt ? Math.max(1, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000)) : 0,
      people: r.people,
      estimatedGb: Number(r.gb ?? 0),
      endReason: r.endReason,
    })),
  };
}

/** Saves the warning level and the all-hands and recording switches. The action has already checked `calls.settings`. */
export async function saveCallSettings(actor: { id: string; email: string }, input: { monthlyGbWarning: number; townhallEnabled: boolean; recordingEnabled: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(callSettings).where(eq(callSettings.id, 1)).for("update").limit(1);
    await tx
      .insert(callSettings)
      .values({ id: 1, monthlyGbWarning: input.monthlyGbWarning, townhallEnabled: input.townhallEnabled, recordingEnabled: input.recordingEnabled })
      .onConflictDoUpdate({ target: callSettings.id, set: { monthlyGbWarning: input.monthlyGbWarning, townhallEnabled: input.townhallEnabled, recordingEnabled: input.recordingEnabled, updatedAt: new Date() } });
    await writeAudit(
      {
        actor,
        action: "call.settings",
        targetType: "call_settings",
        targetId: "1",
        before: before ? { monthlyGbWarning: before.monthlyGbWarning, townhallEnabled: before.townhallEnabled, recordingEnabled: before.recordingEnabled } : undefined,
        after: { monthlyGbWarning: input.monthlyGbWarning, townhallEnabled: input.townhallEnabled, recordingEnabled: input.recordingEnabled },
      },
      tx,
    );
  });
}
