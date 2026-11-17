import "server-only";
import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userRoles, users } from "@/modules/core/schema";
import { departments, teams } from "@/modules/org/schema";
import { employees } from "@/modules/people/schema";
import { broadcastChatSignal } from "./realtime";
import { conversationMembers, conversations } from "./schema";

// Automatic channels: one per team, one per department and one for the whole company, kept in step with ELEVATE's organization.
// Nobody creates, renames or deletes them and nobody edits who is in them (the group functions only touch kind = 'group'): the
// organization decides. Run by a daily job, after a reporting change for the person concerned, and on demand by HR.

type Tx = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export const COMPANY_CHANNEL_TITLE = "Everyone at ERS";

export type SyncResult = { created: number; membersAdded: number; membersRemoved: number; archived: number };

type Desired = { kind: "team" | "department" | "company"; key: string; title: string; teamId: string | null; departmentId: string | null; archived: boolean; members: Set<string> };

/** Active people with a sign-in, with their team and department (not archived, not separated). */
async function loadPeople(tx: Tx): Promise<{ userId: string; teamId: string | null; departmentId: string | null }[]> {
  const rows = await tx
    .select({ userId: employees.userId, teamId: employees.teamId, departmentId: teams.departmentId })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .leftJoin(teams, eq(teams.id, employees.teamId))
    .where(and(isNotNull(employees.userId), isNull(employees.archivedAt), isNull(employees.retentionArchivedAt), ne(employees.status, "separated"), isNull(users.archivedAt), eq(users.isGuest, false)));
  return rows.flatMap((r) => (r.userId ? [{ userId: r.userId, teamId: r.teamId, departmentId: r.departmentId }] : []));
}

async function desiredChannels(tx: Tx): Promise<Desired[]> {
  const people = await loadPeople(tx);
  const teamRows = await tx.select({ id: teams.id, name: teams.name, departmentId: teams.departmentId, archivedAt: teams.archivedAt }).from(teams);
  const deptRows = await tx.select({ id: departments.id, name: departments.name, archivedAt: departments.archivedAt }).from(departments);
  const out: Desired[] = [];
  out.push({ kind: "company", key: "company", title: COMPANY_CHANNEL_TITLE, teamId: null, departmentId: null, archived: false, members: new Set(people.map((p) => p.userId)) });
  for (const t of teamRows) out.push({ kind: "team", key: `team:${t.id}`, title: t.name, teamId: t.id, departmentId: null, archived: !!t.archivedAt, members: new Set(people.filter((p) => p.teamId === t.id).map((p) => p.userId)) });
  for (const d of deptRows) out.push({ kind: "department", key: `department:${d.id}`, title: d.name, teamId: null, departmentId: d.id, archived: !!d.archivedAt, members: new Set(people.filter((p) => p.departmentId === d.id).map((p) => p.userId)) });
  return out;
}

/** Someone to record as the creator of a channel the system makes: the earliest HR Admin or Super Admin. Null when there is none yet. */
async function systemCreator(tx: Tx): Promise<string | null> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(inArray(userRoles.roleSlug, ["hr_admin", "super_admin"]), isNull(users.archivedAt)))
    .orderBy(users.createdAt)
    .limit(1);
  return row?.id ?? null;
}

type Existing = { id: string; kind: string; teamId: string | null; departmentId: string | null; title: string | null; archivedAt: Date | null };

async function existingChannels(tx: Tx): Promise<Existing[]> {
  return tx
    .select({ id: conversations.id, kind: conversations.kind, teamId: conversations.teamId, departmentId: conversations.departmentId, title: conversations.title, archivedAt: conversations.archivedAt })
    .from(conversations)
    .where(inArray(conversations.kind, ["team", "department", "company"]));
}

const keyOf = (c: { kind: string; teamId: string | null; departmentId: string | null }) => (c.kind === "company" ? "company" : c.kind === "team" ? `team:${c.teamId}` : `department:${c.departmentId}`);

/** Brings one channel's people in line: adds the missing (a fresh start), ends the ones who should no longer be in it. */
async function syncMembers(tx: Tx, conversationId: string, want: Set<string>, result: SyncResult, touched: Set<string>): Promise<void> {
  const current = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
  const have = new Set(current.map((c) => c.userId));
  const add = [...want].filter((u) => !have.has(u));
  const remove = [...have].filter((u) => !want.has(u));
  for (let i = 0; i < add.length; i += 100) {
    const batch = add.slice(i, i + 100);
    await tx
      .insert(conversationMembers)
      .values(batch.map((userId) => ({ conversationId, userId, role: "member" })))
      .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { leftAt: null, joinedAt: sql`now()` } });
  }
  if (remove.length > 0) {
    await tx
      .update(conversationMembers)
      .set({ leftAt: sql`now()` })
      .where(and(eq(conversationMembers.conversationId, conversationId), inArray(conversationMembers.userId, remove), isNull(conversationMembers.leftAt)));
  }
  result.membersAdded += add.length;
  result.membersRemoved += remove.length;
  for (const u of [...add, ...remove]) touched.add(u);
}

/** Creates the channel when it is missing (and not archived), or returns the existing one's id. */
async function ensureChannel(tx: Tx, d: Desired, existing: Existing | undefined, creator: string | null, result: SyncResult): Promise<string | null> {
  if (existing) {
    if (d.archived && !existing.archivedAt) {
      await tx.update(conversations).set({ archivedAt: sql`now()` }).where(eq(conversations.id, existing.id));
      result.archived += 1;
      return null;
    }
    if (!d.archived && existing.title !== d.title) await tx.update(conversations).set({ title: d.title }).where(eq(conversations.id, existing.id));
    return existing.archivedAt ? null : existing.id;
  }
  if (d.archived || !creator) return null; // nothing to create, or nobody yet to record as the creator
  const [row] = await tx
    .insert(conversations)
    .values({ kind: d.kind, title: d.title, teamId: d.teamId, departmentId: d.departmentId, posting: d.kind === "company" ? "admins" : "everyone", createdBy: creator })
    .returning({ id: conversations.id });
  result.created += 1;
  return row.id;
}

/** The full sync (daily job, and HR's "Update channels" button). Safe to run twice: the second run changes nothing. */
export async function syncChannels(): Promise<SyncResult & { skipped?: string }> {
  const result: SyncResult = { created: 0, membersAdded: 0, membersRemoved: 0, archived: 0 };
  const touched = new Set<string>();
  const skipped = await db.transaction(async (tx) => {
    // One sync at a time: two at once would both try to create the same channel.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('chat_channel_sync'))`);
    const creator = await systemCreator(tx);
    const desired = await desiredChannels(tx);
    const existing = new Map((await existingChannels(tx)).map((c) => [keyOf(c), c]));
    if (!creator && existing.size === 0) return "No HR Admin or Super Admin exists yet to own the channels.";
    for (const d of desired) {
      const found = existing.get(d.key);
      const id = await ensureChannel(tx, d, found, creator, result);
      if (id) await syncMembers(tx, id, d.members, result, touched);
    }
    return undefined;
  });
  if (touched.size > 0) await notifyChanged(touched);
  return skipped ? { ...result, skipped } : result;
}

/** Updates the channels of one person (after a team change). Creates a missing channel; never removes anybody else. */
export async function syncEmployeeChannels(userId: string): Promise<void> {
  const result: SyncResult = { created: 0, membersAdded: 0, membersRemoved: 0, archived: 0 };
  const touched = new Set<string>();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('chat_channel_sync'))`);
    const creator = await systemCreator(tx);
    if (!creator) return;
    const people = await loadPeople(tx);
    const me = people.find((p) => p.userId === userId);
    const channels = await existingChannels(tx);
    const wantedKeys = new Set<string>();
    if (me) {
      wantedKeys.add("company");
      if (me.teamId) wantedKeys.add(`team:${me.teamId}`);
      if (me.departmentId) wantedKeys.add(`department:${me.departmentId}`);
    }
    const desired = (await desiredChannels(tx)).filter((d) => wantedKeys.has(d.key));
    const byKey = new Map(channels.map((c) => [keyOf(c), c]));
    // Create what the person needs and put them in it.
    for (const d of desired) {
      const id = await ensureChannel(tx, d, byKey.get(d.key), creator, result);
      if (!id) continue;
      const [already] = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId), isNull(conversationMembers.leftAt)));
      if (!already) await syncMembers(tx, id, new Set([...(await currentIds(tx, id)), userId]), result, touched);
    }
    // Take them out of channels they no longer belong to.
    for (const c of channels) {
      if (c.archivedAt || wantedKeys.has(keyOf(c))) continue;
      const have = await currentIds(tx, c.id);
      if (have.has(userId)) await syncMembers(tx, c.id, new Set([...have].filter((u) => u !== userId)), result, touched);
    }
  });
  if (touched.size > 0) await notifyChanged(touched);
}

async function currentIds(tx: Tx, conversationId: string): Promise<Set<string>> {
  const rows = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
  return new Set(rows.map((r) => r.userId));
}

/** People whose channels changed refresh their chat list. (An empty conversation id means "look at everything".) */
async function notifyChanged(userIds: Set<string>): Promise<void> {
  await broadcastChatSignal([...userIds], { type: "members", conversationId: "" });
}
