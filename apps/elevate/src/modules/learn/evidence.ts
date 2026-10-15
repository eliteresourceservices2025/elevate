import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { statusOn, type CertFact, type EvidenceReport } from "./evidence-format";

/**
 * Builds the client evidence report from the database: the people assigned to the client on the date, each with their HIPAA and
 * Cybersecurity certificate status on that date. Reads names, positions and certificate facts only. Callers authorize first.
 */
export async function buildClientEvidence(tx: Pick<typeof db, "execute">, clientId: string, asOf: string): Promise<EvidenceReport | null> {
  const client = (await tx.execute(sql`select name from core.clients where id = ${clientId} and archived_at is null`)) as unknown as { name: string }[];
  if (!client[0]) return null;

  const people = (await tx.execute(sql`
    select e.id, e.user_id, e.legal_first_name, e.legal_last_name, e.position, ca.start_date::text as start_date
    from core.client_assignments ca
    join core.employees e on e.id = ca.employee_id
    where ca.client_id = ${clientId} and ca.start_date <= ${asOf}::date and (ca.end_date is null or ca.end_date >= ${asOf}::date)
      and e.archived_at is null
    order by e.legal_last_name, e.legal_first_name`)) as unknown as { id: string; user_id: string | null; legal_first_name: string; legal_last_name: string; position: string | null; start_date: string }[];

  // The client's own add-on courses that have a live version: more columns in the report (a client may have several).
  const addonRow = (await tx.execute(sql`
    select c.slug, coalesce(c.label, c.title) as label from learn.courses c
    where c.client_id = ${clientId} and c.kind = 'client_addon' and c.archived_at is null
      and exists (select 1 from learn.course_versions v where v.course_id = c.id and v.status = 'published')
    order by lower(coalesce(c.label, c.title)), c.slug`)) as unknown as { slug: string; label: string }[];
  const addonSlugs = addonRow.map((a) => a.slug);

  const certs = new Map<string, CertFact[]>();
  const userIds = people.map((p) => p.user_id).filter((u): u is string => Boolean(u));
  if (userIds.length > 0) {
    const literal = `{${userIds.join(",")}}`;
    const rows = (await tx.execute(sql`
      select c.user_id, co.slug, c.reference, c.issued_on::text as issued_on, c.ends_on::text as ends_on,
             exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id) as revoked
      from learn.certificates c
      join learn.assignments a on a.id = c.assignment_id
      join learn.courses co on co.id = a.course_id
      where c.user_id = any(${literal}::uuid[]) and (co.slug in ('hipaa', 'cybersecurity') or co.slug = any(${`{${addonSlugs.join(",")}}`}::text[]))`)) as unknown as { user_id: string; slug: string; reference: string; issued_on: string; ends_on: string; revoked: boolean }[];
    for (const r of rows) {
      const key = `${r.user_id}:${r.slug}`;
      certs.set(key, [...(certs.get(key) ?? []), { reference: r.reference, issuedOn: r.issued_on, endsOn: r.ends_on, revoked: r.revoked }]);
    }
  }

  return {
    clientName: client[0].name,
    asOf,
    generatedAt: new Date().toISOString(),
    addons: addonRow.map((a) => ({ label: a.label })),
    rows: people.map((p) => ({
      name: `${p.legal_first_name} ${p.legal_last_name}`.trim(),
      position: p.position,
      assignedSince: p.start_date,
      hipaa: statusOn(p.user_id ? (certs.get(`${p.user_id}:hipaa`) ?? []) : [], asOf),
      cybersecurity: statusOn(p.user_id ? (certs.get(`${p.user_id}:cybersecurity`) ?? []) : [], asOf),
      addons: addonSlugs.map((slug) => statusOn(p.user_id ? (certs.get(`${p.user_id}:${slug}`) ?? []) : [], asOf)),
    })),
  };
}
