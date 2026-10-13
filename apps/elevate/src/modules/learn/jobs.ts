import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { managerChainUserIds } from "@/modules/org/service";
import { HIPAA_SLUG } from "./constants";
import { assignmentNeed, describeDue, isOverdue, isoWeekKey, reminderDue, type ReminderKind } from "./rules";

// The nightly work of ELEVATE Learn on ELEVATE's side (docs/learn/02-architecture.md). Learn itself runs no scheduled work.
// Everything here uses ELEVATE's owner connection and goes through the `learn` schema tables; the Learn app never sees any of it.


type Row = Record<string, unknown>;

/** Narrow a run to some people (tests and one-off fixes); the nightly jobs run for everyone. */
export type Scope = { userIds?: string[] };
/** A Postgres array literal of ids (an array passed as a parameter would be expanded into a list). Only well-formed ids survive. */
export const uuidArray = (ids: string[]): string => `{${ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)).join(",")}}`;
const onUsers = (column: ReturnType<typeof sql>, scope?: Scope) => (scope?.userIds ? sql`and ${column} = any(${uuidArray(scope.userIds)}::uuid[])` : sql``);
const rows = async <T = Row>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

// ---- Assigning ------------------------------------------------------------------------------------------------------------------

export type AssignRun = { skipped: boolean; assigned: number; renewals: number; cancelled: number; expired: number };

/**
 * Daily: makes sure everyone who should be trained has an open assignment on the right track, closes assignments of people who left,
 * and marks passed assignments whose certificate has ended as expired. Safe to repeat: a person with an open assignment is skipped,
 * and a second run on the same day changes nothing. Does nothing until a version of the course is published.
 */
export async function runLearnAssign(today: string, scope?: Scope): Promise<AssignRun> {
  const [version] = await rows<{ version_id: string; course_id: string }>(sql`
    select v.id as version_id, c.id as course_id from learn.course_versions v join learn.courses c on c.id = v.course_id
    where c.slug = ${HIPAA_SLUG} and v.status = 'published' and c.archived_at is null`);
  if (!version) return { skipped: true, assigned: 0, renewals: 0, cancelled: 0, expired: 0 };

  // People who left, or whose account was closed: their open assignments end.
  const cancelled = await rows<{ id: string }>(sql`
    update learn.assignments a set status = 'cancelled', closed_at = now()
    where a.course_id = ${version.course_id} and a.status in ('assigned', 'in_progress')
      and (exists (select 1 from core.users u where u.id = a.user_id and u.archived_at is not null)
        or exists (select 1 from core.employees e where e.user_id = a.user_id and e.archived_at is null and e.status = 'separated'))
      ${onUsers(sql`a.user_id`, scope)}
    returning a.id`);

  // A certificate that has ended: the assignment it came from is now expired (a renewal is assigned below).
  const expired = await rows<{ id: string }>(sql`
    update learn.assignments a set status = 'expired', closed_at = now()
    where a.course_id = ${version.course_id} and a.status = 'passed'
      and exists (select 1 from learn.certificates c where c.assignment_id = a.id and c.ends_on < ${today}::date)
      ${onUsers(sql`a.user_id`, scope)}
    returning a.id`);

  const people = await rows<{ user_id: string; start_date: string | null; phi: boolean; open_id: string | null; cert_ends: string | null }>(sql`
    select u.id as user_id, e.start_date::text as start_date,
           exists (select 1 from core.client_assignments ca join core.clients cl on cl.id = ca.client_id
                   where ca.employee_id = e.id and ca.end_date is null and cl.handles_phi and cl.archived_at is null) as phi,
           (select a.id from learn.assignments a where a.user_id = u.id and a.course_id = ${version.course_id} and a.status in ('assigned', 'in_progress') limit 1) as open_id,
           (select max(c.ends_on)::text from learn.certificates c join learn.assignments a on a.id = c.assignment_id
            where c.user_id = u.id and a.course_id = ${version.course_id}
              and not exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id)) as cert_ends
    from core.employees e join core.users u on u.id = e.user_id
    where e.archived_at is null and u.archived_at is null and e.status in ('onboarding', 'active', 'probation', 'on_leave')
      ${onUsers(sql`u.id`, scope)}`);

  let assigned = 0;
  let renewals = 0;
  for (const p of people) {
    const need = assignmentNeed({ today, startDate: p.start_date, openAssignment: p.open_id !== null, latestCertificateEndsOn: p.cert_ends, assignedToPhiClient: p.phi });
    if (!need.assign) continue;
    const made = await db.transaction(async (tx) => {
      const inserted = (await tx.execute(sql`
        insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on)
        select ${p.user_id}, ${version.course_id}, ${version.version_id}, ${need.track}, ${need.reason}, ${need.dueOn}::date
        where not exists (select 1 from learn.assignments a where a.user_id = ${p.user_id} and a.course_id = ${version.course_id} and a.status in ('assigned', 'in_progress'))
        returning id`)) as unknown as { id: string }[];
      if (inserted.length === 0) return false;
      await notify(tx, {
        userId: p.user_id,
        kind: "learn.assigned",
        title: need.reason === "renewal" ? "Your HIPAA training needs renewing" : "HIPAA training is assigned to you",
        body: `Please finish it by ${need.dueOn}. It takes about an hour and your progress is saved.`,
        link: "/learn",
      });
      return true;
    });
    if (made) {
      assigned += 1;
      if (need.reason === "renewal") renewals += 1;
    }
  }

  if (assigned || cancelled.length || expired.length) {
    await writeAudit({ actor: null, action: "learn.assign_run", metadata: { assigned, renewals, cancelled: cancelled.length, expired: expired.length } });
  }
  return { skipped: false, assigned, renewals, cancelled: cancelled.length, expired: expired.length };
}

// ---- Reminders ------------------------------------------------------------------------------------------------------------------

export type RemindRun = { personNotices: number; leadNotices: number; hrSummaries: number };

/**
 * Daily: a notice to the person at 30 days, 7 days and the due date (each once). Once a week (the first run in each ISO week) the
 * people who are overdue are listed to their lead, and HR gets one count. Names and dates only: never scores, and nothing about
 * attempts. Each notice is claimed with a unique row first, so a repeat run or a missed day never sends twice.
 */
export async function runLearnReminders(today: string, scope?: Scope & { hrUserIds?: string[] }): Promise<RemindRun> {
  const open = await rows<{ id: string; user_id: string; employee_id: string | null; name: string; due_on: string }>(sql`
    select a.id, a.user_id, e.id as employee_id,
           coalesce(nullif(btrim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), ''), u.email) as name,
           a.due_on::text as due_on
    from learn.assignments a join core.users u on u.id = a.user_id
    left join lateral (select * from core.employees x where x.user_id = a.user_id and x.archived_at is null order by x.created_at desc limit 1) e on true
    where a.status in ('assigned', 'in_progress') and u.archived_at is null and (e.id is null or e.status <> 'separated')
      ${onUsers(sql`a.user_id`, scope)}`);

  const sentBy = new Map<string, Set<string>>();
  if (open.length) {
    const sent = await rows<{ assignment_id: string; kind: string }>(sql`select assignment_id, kind from learn.reminders where assignment_id = any(${uuidArray(open.map((o) => o.id))}::uuid[])`);
    for (const s of sent) sentBy.set(s.assignment_id, (sentBy.get(s.assignment_id) ?? new Set()).add(s.kind));
  }

  const claim = async (assignmentId: string, kind: string): Promise<boolean> => {
    const r = await rows(sql`insert into learn.reminders (assignment_id, kind) values (${assignmentId}, ${kind}) on conflict do nothing returning kind`);
    return r.length === 1;
  };

  let personNotices = 0;
  const week = isoWeekKey(today);
  const newlyOverdue: typeof open = [];

  for (const a of open) {
    const sent = sentBy.get(a.id) ?? new Set<string>();
    const kind: ReminderKind | null = reminderDue(a.due_on, today, sent);
    if (kind && (await claim(a.id, kind))) {
      await notify(db, {
        userId: a.user_id,
        kind: "learn.reminder",
        title: kind === "d0" ? "Your HIPAA training is due today" : `Your HIPAA training is ${describeDue(a.due_on, today)}`,
        body: "Open training from the menu to continue where you stopped.",
        link: "/learn",
      });
      personNotices += 1;
    }
    if (isOverdue(a.due_on, today) && (await claim(a.id, `overdue-${week}`))) newlyOverdue.push(a);
  }

  // Overdue, once a week: each lead hears about their own people; HR hears one count.
  let leadNotices = 0;
  const byLead = new Map<string, string[]>();
  for (const a of newlyOverdue) {
    if (!a.employee_id) continue;
    const chain = await managerChainUserIds(db, a.employee_id);
    const lead = chain[0];
    if (lead) byLead.set(lead, [...(byLead.get(lead) ?? []), a.name]);
  }
  for (const [lead, names] of byLead) {
    await notify(db, {
      userId: lead,
      kind: "learn.overdue_team",
      title: names.length === 1 ? "A team member's HIPAA training is overdue" : `${names.length} team members' HIPAA training is overdue`,
      body: `${names.slice(0, 6).join(", ")}${names.length > 6 ? `, and ${names.length - 6} more` : ""}.`,
      link: "/training",
    });
    leadNotices += 1;
  }

  let hrSummaries = 0;
  if (newlyOverdue.length) {
    for (const hr of scope?.hrUserIds ?? (await hrUserIds())) {
      await notify(db, { userId: hr, kind: "learn.overdue", title: `${newlyOverdue.length} ${newlyOverdue.length === 1 ? "person has" : "people have"} overdue HIPAA training`, body: "See who is behind and what each needs.", link: "/training" });
      hrSummaries += 1;
    }
  }
  return { personNotices, leadNotices, hrSummaries };
}

// ---- Certificates into ELEVATE's Certificates ---------------------------------------------------------------------------------

export type SyncRun = { recorded: number; archived: number; waiting: number };

/**
 * Every 30 minutes: a certificate earned in Learn is recorded in Certificates (so the existing expiry reminders, the dashboard and
 * HR's list all work from one place). Idempotent: a certificate is recorded once (learn.certificate_sync), and the credential row is
 * unique per person, name and end date. A revoked certificate archives its credential. A person with no people record is left waiting.
 */
export async function runLearnSync(scope?: Scope): Promise<SyncRun> {
  const todo = await rows<{ id: string; user_id: string; issued_on: string; ends_on: string; title: string; employee_id: string | null }>(sql`
    select c.id, c.user_id, c.issued_on::text, c.ends_on::text, co.title,
           (select e.id from core.employees e where e.user_id = c.user_id and e.archived_at is null order by e.created_at desc limit 1) as employee_id
    from learn.certificates c join learn.assignments a on a.id = c.assignment_id join learn.courses co on co.id = a.course_id
    where not exists (select 1 from learn.certificate_sync s where s.certificate_id = c.id)
      ${onUsers(sql`c.user_id`, scope)}
    order by c.created_at limit 200`);

  let recorded = 0;
  let waiting = 0;
  for (const c of todo) {
    if (!c.employee_id) {
      waiting += 1;
      continue;
    }
    await db.transaction(async (tx) => {
      const name = `${c.title} (ERS)`.slice(0, 120);
      const existing = (await tx.execute(sql`
        select id from talent.credentials where employee_id = ${c.employee_id} and lower(name) = lower(${name}) and expires_on = ${c.ends_on}::date and archived_at is null limit 1`)) as unknown as { id: string }[];
      let credentialId = existing[0]?.id;
      if (!credentialId) {
        const made = (await tx.execute(sql`
          insert into talent.credentials (employee_id, name, issued_on, expires_on, source)
          values (${c.employee_id}, ${name}, ${c.issued_on}::date, ${c.ends_on}::date, 'learn') returning id`)) as unknown as { id: string }[];
        credentialId = made[0].id;
      }
      await tx.execute(sql`insert into learn.certificate_sync (certificate_id, credential_id) values (${c.id}, ${credentialId}) on conflict do nothing`);
      await notify(tx, { userId: c.user_id, kind: "learn.certified", title: "Your HIPAA training certificate is recorded", body: `Valid until ${c.ends_on}. It also appears under Certificates.`, link: "/credentials" });
    });
    recorded += 1;
  }

  // A revoked certificate takes its credential out of the active list.
  const archived = await rows<{ id: string }>(sql`
    update talent.credentials k set archived_at = now()
    from learn.certificate_sync s
    where k.id = s.credential_id and k.archived_at is null
      and exists (select 1 from learn.certificate_revocations r where r.certificate_id = s.certificate_id)
      ${scope?.userIds ? sql`and s.certificate_id in (select id from learn.certificates where user_id = any(${uuidArray(scope.userIds)}::uuid[]))` : sql``}
    returning k.id`);

  if (recorded || archived.length) await writeAudit({ actor: null, action: "learn.sync", metadata: { recorded, archived: archived.length } });
  return { recorded, archived: archived.length, waiting };
}

// ---- Clean-up -----------------------------------------------------------------------------------------------------------------

export type PurgeRun = { tokens: number; sessions: number; answers: number };

/**
 * Daily: removes finished sign-in tokens and sessions, and per-question exam answers 12 months after the exam was submitted. The
 * score, the pass result, the attestation and the certificate stay (six years). Answers can only be deleted by this job: it sets
 * learn.purge for its own transaction, which the database's guard checks.
 */
export async function runLearnPurge(): Promise<PurgeRun> {
  return db.transaction(async (tx) => {
    const tokens = (await tx.execute(sql`delete from learn.launch_tokens where expires_at < now() - interval '1 day' returning 1`)) as unknown as unknown[];
    const sessions = (await tx.execute(sql`delete from learn.sessions where (ended_at is not null and ended_at < now() - interval '7 days') or expires_at < now() - interval '7 days' returning 1`)) as unknown as unknown[];
    await tx.execute(sql`select set_config('learn.purge', 'on', true)`);
    const answers = (await tx.execute(sql`
      delete from learn.exam_answers where attempt_id in (select id from learn.exam_attempts where status = 'submitted' and submitted_at < now() - interval '12 months')
      returning 1`)) as unknown as unknown[];
    return { tokens: tokens.length, sessions: sessions.length, answers: answers.length };
  });
}
