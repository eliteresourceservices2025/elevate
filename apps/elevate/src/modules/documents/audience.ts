import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { AuthzUser } from "@/lib/authz";
import type { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import type { AudienceKind, AudienceMember } from "./audience-rules";

// Restricted company documents (owner decision 2026-11-24): who a company file is for, as any mix of teams, clients, roles and named people.
// Server-only helpers (not server actions, so they may take a transaction or a viewer). Callers authorize first.

type Executor = Pick<typeof db, "execute">;

/** Replaces the groups a restricted document is for. Every group must exist; a missing one stops the whole change. */
export async function saveAudience(tx: Executor, documentId: string, members: AudienceMember[]): Promise<void> {
  // A group the file already has stays valid even if it was archived since (it must stay possible to untick it and save), so only NEW groups are checked.
  const existing = (await tx.execute(sql`select kind, coalesce(team_id, client_id, employee_id)::text as ref, role_slug from docs.document_audience_members where document_id = ${documentId}`)) as unknown as { kind: AudienceKind; ref: string | null; role_slug: string | null }[];
  const had = new Set(existing.map((e) => `${e.kind}:${e.role_slug ?? e.ref}`));
  await tx.execute(sql`delete from docs.document_audience_members where document_id = ${documentId}`);
  const unique = [...new Map(members.map((m) => [`${m.kind}:${m.id}`, m])).values()];
  for (const m of unique) {
    const ok =
      m.kind === "role" || had.has(`${m.kind}:${m.id}`)
        ? true
        : ((await tx.execute(
            m.kind === "team"
              ? sql`select 1 as ok from core.teams where id = ${m.id} and archived_at is null`
              : m.kind === "client"
                ? sql`select 1 as ok from core.clients where id = ${m.id} and archived_at is null`
                : sql`select 1 as ok from core.employees where id = ${m.id} and archived_at is null and status <> 'separated'`,
          )) as unknown as unknown[]).length > 0;
    if (!ok) throw new ActionFailure("One of the groups was not found. Choose again.");
    await tx.execute(sql`insert into docs.document_audience_members (document_id, kind, team_id, client_id, role_slug, employee_id) values (
      ${documentId}, ${m.kind}, ${m.kind === "team" ? m.id : null}, ${m.kind === "client" ? m.id : null}, ${m.kind === "role" ? m.id : null}, ${m.kind === "person" ? m.id : null})`);
  }
}

export type AudienceGroup = { kind: AudienceKind; id: string; label: string };

/** The groups of some restricted documents, with names, for HR's list. */
export async function loadAudiences(executor: Executor, documentIds: string[]): Promise<Map<string, AudienceGroup[]>> {
  const out = new Map<string, AudienceGroup[]>();
  if (documentIds.length === 0) return out;
  const found = (await executor.execute(sql`
    select m.document_id, m.kind, coalesce(m.team_id, m.client_id, m.employee_id)::text as ref, m.role_slug,
           coalesce(t.name, c.name, nullif(trim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), ''), m.role_slug) as label
    from docs.document_audience_members m
    left join core.teams t on t.id = m.team_id
    left join core.clients c on c.id = m.client_id
    left join core.employees e on e.id = m.employee_id
    where m.document_id in (${sql.join(documentIds.map((id) => sql`${id}`), sql`, `)})
    order by m.kind, label`)) as unknown as { document_id: string; kind: AudienceKind; ref: string | null; role_slug: string | null; label: string }[];
  for (const r of found) out.set(r.document_id, [...(out.get(r.document_id) ?? []), { kind: r.kind, id: r.role_slug ?? r.ref ?? "", label: r.label }]);
  return out;
}

export type ViewerKeys = { employeeId: string | null; teamId: string | null; clientIds: string[]; roles: string[] };

/** What a viewer matches a restricted document by: their people record, team, current client assignments and roles. */
export async function viewerKeys(executor: Executor, viewer: Pick<AuthzUser, "id" | "roles">): Promise<ViewerKeys> {
  const [me] = (await executor.execute(sql`select id, team_id from core.employees where user_id = ${viewer.id} and archived_at is null limit 1`)) as unknown as { id: string; team_id: string | null }[];
  const clientRows = me
    ? ((await executor.execute(sql`select distinct client_id from core.client_assignments where employee_id = ${me.id} and start_date <= current_date and (end_date is null or end_date >= current_date)`)) as unknown as { client_id: string }[])
    : [];
  return { employeeId: me?.id ?? null, teamId: me?.team_id ?? null, clientIds: clientRows.map((c) => c.client_id), roles: [...viewer.roles] };
}

const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

/** SQL (for a where clause on `docs.documents`) true when the viewer matches any group of the document. Use with `audience = 'restricted'`. */
export function matchesAudienceSql(documentIdColumn: SQL, keys: ViewerKeys): SQL {
  const conditions: SQL[] = [];
  if (keys.teamId) conditions.push(sql`(m.kind = 'team' and m.team_id = ${keys.teamId})`);
  if (keys.clientIds.length > 0) conditions.push(sql`(m.kind = 'client' and m.client_id in (${list(keys.clientIds)}))`);
  if (keys.roles.length > 0) conditions.push(sql`(m.kind = 'role' and m.role_slug in (${list(keys.roles)}))`);
  if (keys.employeeId) conditions.push(sql`(m.kind = 'person' and m.employee_id = ${keys.employeeId})`);
  if (conditions.length === 0) return sql`false`;
  return sql`exists (select 1 from docs.document_audience_members m where m.document_id = ${documentIdColumn} and (${sql.join(conditions, sql` or `)}))`;
}

/** Whether the viewer is in the audience of one restricted document. */
export async function inAudience(executor: Executor, viewer: Pick<AuthzUser, "id" | "roles">, documentId: string): Promise<boolean> {
  const keys = await viewerKeys(executor, viewer);
  const [row] = (await executor.execute(sql`select 1 as ok where ${matchesAudienceSql(sql`${documentId}::uuid`, keys)}`)) as unknown as { ok: number }[];
  return Boolean(row);
}
