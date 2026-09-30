import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { SENSITIVE_FIELDS, SENSITIVE_LABELS, CHANGE_CATEGORY_LABELS, type ChangeCategory } from "@/modules/people/constants";
import type { MyData } from "./types";

// Server-only. Gathers what ELEVATE holds about ONE person, keyed on their own account. Callers authorize first.
// Sensitive fields are returned as the stored masks only: nothing here decrypts anything.

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);
const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const query = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];

export async function collectMyData(userId: string, email: string): Promise<MyData> {
  const [e] = await query(sql`
    select e.id, e.employee_number, e.legal_first_name, e.legal_middle_name, e.legal_last_name, e.preferred_name,
           e.birth_date, e.civil_status, e.work_email, e.personal_email, e.mobile, e.address_line, e.city, e.province,
           e.postal_code, e.country, e.status, e.worker_type, e.position, e.start_date, e.end_date,
           t.name as team, m.legal_first_name as manager_first, m.legal_last_name as manager_last
    from core.employees e
    left join core.teams t on t.id = e.team_id
    left join core.employees m on m.id = e.manager_id
    where e.user_id = ${userId} and e.archived_at is null
    limit 1`);
  const employeeId = e ? String(e.id) : null;

  const masks = employeeId
    ? ((await query(sql`select masks from core.employee_sensitive where employee_id = ${employeeId}`))[0]?.masks as Record<string, string> | undefined) ?? {}
    : {};

  const history = employeeId
    ? await query(sql`select effective_date, event_type, summary from core.employment_history where employee_id = ${employeeId} order by created_at desc limit 200`)
    : [];
  const contacts = employeeId
    ? await query(sql`select name, relationship, phone, is_primary from core.emergency_contacts where employee_id = ${employeeId} and archived_at is null order by is_primary desc, name`)
    : [];
  const clients = employeeId
    ? await query(sql`select c.name, a.start_date, a.end_date, a.hours_per_week::text as hours from core.client_assignments a join core.clients c on c.id = a.client_id where a.employee_id = ${employeeId} order by a.start_date desc`)
    : [];
  const documents = employeeId
    ? await query(sql`
        select d.title, t.name as type, d.expires_on, d.verified_at, d.created_at
        from docs.documents d join docs.document_types t on t.id = d.type_id
        where d.employee_id = ${employeeId} and d.status = 'active' and d.archived_at is null order by d.created_at desc`)
    : [];
  const requests = employeeId
    ? await query(sql`select category, status, created_at from core.change_requests where employee_id = ${employeeId} order by created_at desc limit 100`)
    : [];
  const acknowledgments = await query(sql`
    select k.acknowledged_at, coalesce(a.title, p.title) as title,
           case when k.announcement_id is not null then 'Announcement' else 'Policy' end as kind, pv.version
    from docs.acknowledgments k
    left join docs.announcements a on a.id = k.announcement_id
    left join docs.policy_versions pv on pv.id = k.policy_version_id
    left join docs.policies p on p.id = pv.policy_id
    where k.user_id = ${userId}
    order by k.acknowledged_at desc limit 200`);
  // Audit entries about this person's own record or made by them. Who else acted is not named.
  const activity = await query(sql`
    select occurred_at, action, (actor_user_id = ${userId}) as by_me
    from ops.audit_log
    where actor_user_id = ${userId} ${employeeId ? sql`or (target_type = 'employee' and target_id = ${employeeId})` : sql``}
    order by id desc limit 200`);

  return {
    generatedAt: new Date().toISOString(),
    account: { email },
    profile: e
      ? {
          employeeNumber: String(e.employee_number),
          legalFirstName: String(e.legal_first_name),
          legalMiddleName: str(e.legal_middle_name),
          legalLastName: String(e.legal_last_name),
          preferredName: str(e.preferred_name),
          birthDate: dateOnly(e.birth_date),
          civilStatus: str(e.civil_status),
          workEmail: String(e.work_email),
          personalEmail: str(e.personal_email),
          mobile: str(e.mobile),
          address: [e.address_line, e.city, e.province, e.postal_code, e.country].filter(Boolean).map(String).join(", ") || null,
          status: String(e.status),
          workerType: String(e.worker_type),
          position: str(e.position),
          team: str(e.team),
          manager: e.manager_first ? `${e.manager_first} ${e.manager_last}` : null,
          startDate: dateOnly(e.start_date),
          endDate: dateOnly(e.end_date),
        }
      : null,
    sensitive: SENSITIVE_FIELDS.map((f) => ({ field: f, label: SENSITIVE_LABELS[f], masked: masks[f] ?? null })), // eslint-disable-line security/detect-object-injection
    history: history.map((h) => ({ date: dateOnly(h.effective_date)!, event: String(h.event_type), summary: String(h.summary) })),
    emergencyContacts: contacts.map((c) => ({ name: String(c.name), relationship: String(c.relationship), phone: String(c.phone), primary: Boolean(c.is_primary) })),
    clients: clients.map((c) => ({ client: String(c.name), startDate: dateOnly(c.start_date)!, endDate: dateOnly(c.end_date), hoursPerWeek: str(c.hours) })),
    documents: documents.map((d) => ({ title: String(d.title), type: String(d.type), expiresOn: dateOnly(d.expires_on), verified: d.verified_at !== null, uploadedAt: iso(d.created_at)! })),
    acknowledgments: acknowledgments.map((a) => ({ title: String(a.title), kind: String(a.kind), version: a.version === null ? null : Number(a.version), at: iso(a.acknowledged_at)! })),
    requests: requests.map((r) => ({ category: CHANGE_CATEGORY_LABELS[r.category as ChangeCategory] ?? String(r.category), status: String(r.status), createdAt: iso(r.created_at)! })),
    activity: activity.map((a) => ({ at: iso(a.occurred_at)!, action: String(a.action), by: a.by_me ? "You" : "HR or system" })),
  };
}
