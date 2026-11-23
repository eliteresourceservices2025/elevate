import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { clientProjects, clients } from "@/modules/people/schema";
import { replayClock, workLog } from "./clock";
import { assignedClients } from "./extra-hours-service";
import { loadEventsBetween } from "./service";

type Executor = Parameters<typeof loadEventsBetween>[0] & Pick<typeof db, "select">;

/** A stretch of working time with the names of the client and project it belonged to. Times are milliseconds since the epoch (UTC). */
export type NamedStretch = { from: number; to: number; clientId: string | null; clientName: string | null; projectId: string | null; projectName: string | null };

/** A session can run a long way back from the window's start; events this far before it are read so the stretch that is open at the start is right. */
const LOOKBACK_MS = 36 * 3_600_000;

/**
 * Where a person's time went between two instants: each stretch with its client and project and exact times, breaks left out, cut to the
 * window. Read from the clock events only (evidence of who the time was for, never a pay figure).
 */
export async function loadWorkLog(executor: Executor, employeeId: string, fromMs: number, toMs: number): Promise<NamedStretch[]> {
  const events = await loadEventsBetween(executor, employeeId, fromMs - LOOKBACK_MS, toMs);
  const stretches = replayClock(events)
    .sessions.flatMap((s) => workLog(s, Math.min(toMs, Date.now()))) // an open session counts up to now, never to the end of a wider window
    .map((s) => ({ ...s, from: Math.max(s.from, fromMs), to: Math.min(s.to, toMs) }))
    .filter((s) => s.to > s.from);
  const clientIds = [...new Set(stretches.map((s) => s.clientId).filter((x): x is string => x !== null))];
  const projectIds = [...new Set(stretches.map((s) => s.projectId).filter((x): x is string => x !== null))];
  const clientNames = new Map<string, string>();
  const projectNames = new Map<string, string>();
  if (clientIds.length) for (const c of await executor.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, clientIds))) clientNames.set(c.id, c.name);
  if (projectIds.length) for (const p of await executor.select({ id: clientProjects.id, name: clientProjects.name }).from(clientProjects).where(inArray(clientProjects.id, projectIds))) projectNames.set(p.id, p.name);
  return stretches.map((s) => ({ ...s, clientName: s.clientId ? (clientNames.get(s.clientId) ?? null) : null, projectName: s.projectId ? (projectNames.get(s.projectId) ?? null) : null }));
}

/** The clients a person is assigned to today, each with its active projects (by name). People pick from these on the clock. */
export async function assignedClientsWithProjects(executor: Parameters<typeof assignedClients>[0] & Pick<typeof db, "select">, employeeId: string): Promise<{ id: string; name: string; projects: { id: string; name: string }[] }[]> {
  const assigned = await assignedClients(executor, employeeId);
  if (assigned.length === 0) return [];
  const projects = await executor
    .select({ id: clientProjects.id, clientId: clientProjects.clientId, name: clientProjects.name })
    .from(clientProjects)
    .where(
      and(
        inArray(clientProjects.clientId, assigned.map((c) => c.id)),
        isNull(clientProjects.archivedAt),
        // A project with people listed is only for them; with nobody listed it is open to everyone assigned to the client.
        sql`(not exists (select 1 from core.client_project_members m where m.project_id = ${clientProjects.id})
          or exists (select 1 from core.client_project_members m where m.project_id = ${clientProjects.id} and m.employee_id = ${employeeId}))`,
      ),
    )
    .orderBy(clientProjects.name);
  return assigned.map((c) => ({ id: c.id, name: c.name, projects: projects.filter((p) => p.clientId === c.id).map((p) => ({ id: p.id, name: p.name })) }));
}

/** Who each clocked-in person is working for right now (only people whose open session has a client), with the time that stretch began. */
export async function loadCurrentWork(executor: Executor, employeeIds: readonly string[], now = Date.now()): Promise<Map<string, { client: string | null; project: string | null; sinceMs: number }>> {
  const out = new Map<string, { client: string | null; project: string | null; sinceMs: number }>();
  for (const id of employeeIds) {
    const open = replayClock(await loadEventsBetween(executor, id, now - 48 * 3_600_000, now)).sessions.at(-1);
    if (!open || open.endAt !== null) continue;
    const last = open.switches.at(-1);
    const clientId = last ? last.clientId : open.clientId;
    if (!clientId) continue;
    const projectId = last ? last.projectId : open.projectId;
    const [client] = await executor.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
    const [project] = projectId ? await executor.select({ name: clientProjects.name }).from(clientProjects).where(eq(clientProjects.id, projectId)).limit(1) : [];
    out.set(id, { client: client?.name ?? null, project: project?.name ?? null, sinceMs: last ? last.at : open.startAt });
  }
  return out;
}
