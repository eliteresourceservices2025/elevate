import "server-only";
import { desc, eq, gte, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
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

/** Saves the warning level and the all-hands switch. The action has already checked `calls.settings`. */
export async function saveCallSettings(actor: { id: string; email: string }, input: { monthlyGbWarning: number; townhallEnabled: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(callSettings).where(eq(callSettings.id, 1)).for("update").limit(1);
    await tx
      .insert(callSettings)
      .values({ id: 1, monthlyGbWarning: input.monthlyGbWarning, townhallEnabled: input.townhallEnabled })
      .onConflictDoUpdate({ target: callSettings.id, set: { monthlyGbWarning: input.monthlyGbWarning, townhallEnabled: input.townhallEnabled, updatedAt: new Date() } });
    await writeAudit(
      {
        actor,
        action: "call.settings",
        targetType: "call_settings",
        targetId: "1",
        before: before ? { monthlyGbWarning: before.monthlyGbWarning, townhallEnabled: before.townhallEnabled } : undefined,
        after: { monthlyGbWarning: input.monthlyGbWarning, townhallEnabled: input.townhallEnabled },
      },
      tx,
    );
  });
}
