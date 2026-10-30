import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { archiveSystemDocuments, fileSystemDocument } from "@/modules/documents/service";
import { queueEmails, type QueuedEmail } from "@/modules/notifications/email-queue";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { managerChainUserIds } from "@/modules/org/service";
import { renderCertificatePdf } from "./certificate-pdf";
import { HIPAA_SLUG } from "./constants";
import { findLearnCourse, listLearnCourses } from "./course-catalog";
import { learnBaseUrl } from "./token";
import { addDays, addonNeed, assignmentNeed, changedScopes, describeDue, isOverdue, isoWeekKey, reminderDue, UPDATE_DUE_DAYS, updateQuestionCount, type ReminderKind } from "./rules";

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

export type AssignRun = { skipped: boolean; mode?: "all" | "teams" | "paused"; assigned: number; renewals: number; cancelled: number; expired: number; updates?: number; updatesSkipped?: number };

/**
 * Daily: makes sure everyone who should be trained has an open assignment on the right track, closes assignments of people who left,
 * and marks passed assignments whose certificate has ended as expired. Safe to repeat: a person with an open assignment is skipped,
 * and a second run on the same day changes nothing. Does nothing until a version of the course is published.
 */
export async function runLearnAssign(today: string, scope?: Scope, courseSlug: string = HIPAA_SLUG): Promise<AssignRun> {
  const info = await findLearnCourse(db, courseSlug);
  // A client add-on is for the people currently assigned to its client; a core course is for everyone.
  const addonClient = info?.kind === "client_addon" ? info.clientId : null;
  if (!info || (info.kind === "client_addon" && !addonClient)) return { skipped: true, assigned: 0, renewals: 0, cancelled: 0, expired: 0 };
  const [version] = await rows<{ version_id: string; course_id: string }>(sql`
    select v.id as version_id, c.id as course_id from learn.course_versions v join learn.courses c on c.id = v.course_id
    where c.slug = ${info.slug} and v.status = 'published' and c.archived_at is null`);
  if (!version) return { skipped: true, assigned: 0, renewals: 0, cancelled: 0, expired: 0 };

  // Who is assigned automatically (no rule = everyone). Closing out leavers and expired certificates happens in every mode.
  const [rule] = await rows<{ mode: "all" | "teams" | "paused"; team_ids: string[] }>(sql`select mode, team_ids from learn.assignment_rules where course_id = ${version.course_id}`);
  const mode = rule?.mode ?? "all";
  const pilotTeams = new Set(rule?.team_ids ?? []);

  // People who left, or whose account was closed: their open assignments end.
  const cancelled = await rows<{ id: string }>(sql`
    update learn.assignments a set status = 'cancelled', closed_at = now()
    where a.course_id = ${version.course_id} and a.status in ('assigned', 'in_progress')
      and (exists (select 1 from core.users u where u.id = a.user_id and u.archived_at is not null)
        or exists (select 1 from core.employees e where e.user_id = a.user_id and e.archived_at is null and e.status = 'separated')
        ${addonClient ? sql`or (a.created_by is null
              and exists (select 1 from core.employees e2 where e2.user_id = a.user_id and e2.archived_at is null)
              and not exists (select 1 from core.client_assignments ca join core.employees e3 on e3.id = ca.employee_id
                              where e3.user_id = a.user_id and ca.client_id = ${addonClient}::uuid and ca.end_date is null))` : sql``})
      ${onUsers(sql`a.user_id`, scope)}
    returning a.id`);

  // A certificate that has ended: the assignment it came from is now expired (a renewal is assigned below).
  const expired = await rows<{ id: string }>(sql`
    update learn.assignments a set status = 'expired', closed_at = now()
    where a.course_id = ${version.course_id} and a.status = 'passed'
      and (exists (select 1 from learn.certificates c where c.assignment_id = a.id and c.ends_on < ${today}::date)
        -- an update module has no certificate of its own: it closes when the person has no valid certificate left in the course
        or (a.reason = 'update' and not exists (select 1 from learn.certificates c2 where c2.user_id = a.user_id and c2.ends_on >= ${today}::date
              and exists (select 1 from learn.assignments a2 where a2.id = c2.assignment_id and a2.course_id = a.course_id))))
      ${onUsers(sql`a.user_id`, scope)}
    returning a.id`);

  // Training HR assigned to a new hire before they had an account: once the record is linked to an account it becomes a real assignment
  // (in every mode, since HR chose it by hand). Rows for people who left are dropped.
  let queuedMade = 0;
  await rows(sql`
    delete from learn.pending_assignments p where p.course_id = ${version.course_id}
      and exists (select 1 from core.employees e where e.id = p.employee_id and (e.archived_at is not null or e.status = 'separated'))`);
  const queued = await rows<{ user_id: string; employee_id: string; track: string; start_date: string | null }>(sql`
    select u.id as user_id, p.employee_id::text as employee_id, p.track, e.start_date::text as start_date
    from learn.pending_assignments p join core.employees e on e.id = p.employee_id join core.users u on u.id = e.user_id
    where p.course_id = ${version.course_id} and e.archived_at is null and u.archived_at is null ${onUsers(sql`u.id`, scope)}`);
  for (const q of queued) {
    const need = assignmentNeed({ today, startDate: q.start_date, openAssignment: false, latestCertificateEndsOn: null, assignedToPhiClient: false });
    if (!need.assign) continue;
    const track = info.fixedTrack ?? q.track;
    const made = await db.transaction(async (tx) => {
      const inserted = (await tx.execute(sql`
        insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on)
        select ${q.user_id}, ${version.course_id}, ${version.version_id}, ${track}, ${need.reason}, ${need.dueOn}::date
        where not exists (select 1 from learn.assignments a where a.user_id = ${q.user_id} and a.course_id = ${version.course_id} and a.status in ('assigned', 'in_progress'))
        returning id`)) as unknown as { id: string }[];
      await tx.execute(sql`delete from learn.pending_assignments where employee_id = ${q.employee_id}::uuid and course_id = ${version.course_id}`);
      if (inserted.length === 0) return false;
      await notify(tx, {
        userId: q.user_id,
        kind: "learn.assigned",
        title: `${info.noun.charAt(0).toUpperCase()}${info.noun.slice(1)} is assigned to you`,
        body: `Please finish it by ${need.dueOn}. Your progress is saved as you go.`,
        link: "/learn",
      });
      return true;
    });
    if (made) queuedMade += 1;
  }

  const people = await rows<{ user_id: string; start_date: string | null; joined_on: string | null; team_id: string | null; phi: boolean; open_id: string | null; cert_ends: string | null }>(sql`
    select u.id as user_id, e.start_date::text as start_date, e.team_id::text as team_id,
           ${addonClient ? sql`(select min(ca2.start_date)::text from core.client_assignments ca2 where ca2.employee_id = e.id and ca2.client_id = ${addonClient}::uuid and ca2.end_date is null)` : sql`null::text`} as joined_on,
           exists (select 1 from core.client_assignments ca join core.clients cl on cl.id = ca.client_id
                   where ca.employee_id = e.id and ca.end_date is null and cl.handles_phi and cl.archived_at is null) as phi,
           (select a.id from learn.assignments a where a.user_id = u.id and a.course_id = ${version.course_id} and a.status in ('assigned', 'in_progress') limit 1) as open_id,
           (select max(c.ends_on)::text from learn.certificates c join learn.assignments a on a.id = c.assignment_id
            where c.user_id = u.id and a.course_id = ${version.course_id}
              and not exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id)) as cert_ends
    from core.employees e join core.users u on u.id = e.user_id
    where e.archived_at is null and u.archived_at is null and e.status in ('onboarding', 'active', 'probation', 'on_leave')
      ${addonClient ? sql`and exists (select 1 from core.client_assignments ca3 where ca3.employee_id = e.id and ca3.client_id = ${addonClient}::uuid and ca3.end_date is null)` : sql``}
      ${onUsers(sql`u.id`, scope)}`);

  let assigned = queuedMade;
  let renewals = 0;
  for (const p of mode === "paused" ? [] : people) {
    if (mode === "teams" && !(p.team_id && pilotTeams.has(p.team_id))) continue;
    // An add-on counts from the day the person joined the client; a core course from their start date.
    const need = addonClient
      ? addonNeed({ today, joinedOn: p.joined_on, openAssignment: p.open_id !== null, latestCertificateEndsOn: p.cert_ends })
      : assignmentNeed({ today, startDate: p.start_date, openAssignment: p.open_id !== null, latestCertificateEndsOn: p.cert_ends, assignedToPhiClient: p.phi });
    if (!need.assign) continue;
    const track = info.fixedTrack ?? need.track;
    const made = await db.transaction(async (tx) => {
      const inserted = (await tx.execute(sql`
        insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on)
        select ${p.user_id}, ${version.course_id}, ${version.version_id}, ${track}, ${need.reason}, ${need.dueOn}::date
        where not exists (select 1 from learn.assignments a where a.user_id = ${p.user_id} and a.course_id = ${version.course_id} and a.status in ('assigned', 'in_progress'))
        returning id`)) as unknown as { id: string }[];
      if (inserted.length === 0) return false;
      await notify(tx, {
        userId: p.user_id,
        kind: "learn.assigned",
        title: need.reason === "renewal" ? `Your ${info.noun} needs renewing` : `${info.noun.charAt(0).toUpperCase()}${info.noun.slice(1)} is assigned to you`,
        body: `Please finish it by ${need.dueOn}. Your progress is saved as you go.`,
        link: "/learn",
      });
      return true;
    });
    if (made) {
      assigned += 1;
      if (need.reason === "renewal") renewals += 1;
    }
  }

  const upd = await runUpdateAssignments({ today, courseId: version.course_id, courseSlug: info.slug, versionId: version.version_id, noun: info.noun, scope, mode, pilotTeams });

  if (assigned || cancelled.length || expired.length) {
    await writeAudit({ actor: null, action: "learn.assign_run", metadata: { course: info.slug, mode, assigned, renewals, cancelled: cancelled.length, expired: expired.length } });
  }
  return { skipped: false, mode, assigned, renewals, cancelled: cancelled.length, expired: expired.length, updates: upd.assigned, updatesSkipped: upd.skipped };
}

// ---- Update modules --------------------------------------------------------------------------------------------------------------

/** A Postgres text[] literal of module keys (only plain keys survive). */
const pgTextArray = (keys: string[]): string => `{${keys.filter((k) => /^[a-z0-9_]+$/.test(k)).join(",")}}`;

export type UpdateRun = { assigned: number; skipped: number };

/**
 * After a version marked "material" is published: people whose valid certificate is on an older version get a short update
 * assignment (reason "update") covering only the modules that changed, due in 30 days, ending with a few questions from them.
 * Their certificate keeps its own dates; finishing the update records their acceptance and issues nothing. People with an open
 * assignment are left alone (they finish the version they started and the next renewal brings them up to date). A change that
 * touches no module in someone's track, or only modules with no question, assigns nothing and is counted as skipped.
 */
async function runUpdateAssignments(opts: { today: string; courseId: string; courseSlug: string; versionId: string; noun: string; scope?: Scope; mode: "all" | "teams" | "paused"; pilotTeams: Set<string> }): Promise<UpdateRun> {
  const { today, courseId, versionId } = opts;
  if (opts.mode === "paused") return { assigned: 0, skipped: 0 };
  const [current] = await rows<{ version: number; content: { modules?: { key: string; screens?: { id: string }[] }[] } }>(sql`select version, content from learn.course_versions where id = ${versionId}`);
  if (!current) return { assigned: 0, skipped: 0 };
  const due = await rows<{ user_id: string; team_id: string | null; track: string; from_version_id: string }>(sql`
    select u.id as user_id, e.team_id::text as team_id, cert.track, cert.version_id::text as from_version_id
    from core.employees e join core.users u on u.id = e.user_id
    cross join lateral (
      select c.track, c.version_id from learn.certificates c join learn.assignments a on a.id = c.assignment_id
      where c.user_id = u.id and a.course_id = ${courseId} and c.ends_on >= ${today}::date
        and not exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id)
      order by c.issued_on desc, c.ends_on desc limit 1
    ) cert
    join learn.course_versions fv on fv.id = cert.version_id
    where e.archived_at is null and u.archived_at is null and e.status in ('onboarding', 'active', 'probation', 'on_leave')
      and fv.version < ${current.version}
      and exists (select 1 from learn.course_versions m where m.course_id = ${courseId} and m.material and m.version > fv.version and m.version <= ${current.version})
      and not exists (select 1 from learn.assignments o where o.user_id = u.id and o.course_id = ${courseId} and (o.status in ('assigned', 'in_progress') or (o.reason = 'update' and o.version_id = ${versionId} and o.status <> 'cancelled')))
      ${onUsers(sql`u.id`, opts.scope)}`);
  if (due.length === 0) return { assigned: 0, skipped: 0 };

  const contentOf = new Map<string, { key: string; screens?: { id: string }[] }[]>();
  const modulesOf = async (id: string) => {
    if (!contentOf.has(id)) {
      const [r] = await rows<{ content: { modules?: { key: string; screens?: { id: string }[] }[] } }>(sql`select content from learn.course_versions where id = ${id}`);
      contentOf.set(id, r?.content?.modules ?? []);
    }
    return contentOf.get(id)!;
  };
  const trackKeys = new Map<string, Set<string>>();
  const keysFor = async (track: string) => {
    if (!trackKeys.has(track)) {
      const r = await rows<{ module_key: string }>(sql`select module_key from learn.version_modules where version_id = ${versionId} and ${track} = any(tracks)`);
      trackKeys.set(track, new Set(r.map((x) => x.module_key)));
    }
    return trackKeys.get(track)!;
  };

  let assigned = 0;
  let skipped = 0;
  const newModules = current.content.modules ?? [];
  for (const p of due) {
    if (opts.mode === "teams" && !(p.team_id && opts.pilotTeams.has(p.team_id))) continue;
    const scopes = changedScopes(await modulesOf(p.from_version_id), newModules, await keysFor(p.track));
    const changed = scopes.map((s) => s.key);
    if (changed.length === 0) { skipped += 1; continue; }
    const [{ n }] = await rows<{ n: number }>(sql`select count(*)::int as n from learn.questions where version_id = ${versionId} and module_key = any(${pgTextArray(changed)}::text[])`);
    const count = updateQuestionCount(n);
    if (count === 0) { skipped += 1; continue; }
    const dueOn = addDays(today, UPDATE_DUE_DAYS);
    const made = await db.transaction(async (tx) => {
      const inserted = (await tx.execute(sql`
        insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on)
        select ${p.user_id}, ${courseId}, ${versionId}, ${p.track}, 'update', ${dueOn}::date
        where not exists (select 1 from learn.assignments a where a.user_id = ${p.user_id} and a.course_id = ${courseId} and a.status in ('assigned', 'in_progress'))
        returning id`)) as unknown as { id: string }[];
      if (inserted.length === 0) return false;
      await tx.execute(sql`
        insert into learn.update_scopes (assignment_id, from_version_id, module_keys, screens, question_count)
        values (${inserted[0].id}, ${p.from_version_id}, ${pgTextArray(changed)}::text[], ${JSON.stringify(Object.fromEntries(scopes.map((s) => [s.key, s.screens])))}::jsonb, ${count})`);
      await notify(tx, {
        userId: p.user_id,
        kind: "learn.update_assigned",
        title: `A short update to your ${opts.noun} is ready`,
        body: `Some lessons changed. It takes a few minutes; please finish it by ${dueOn}. Your certificate stays valid.`,
        link: "/learn",
      });
      return true;
    });
    if (made) assigned += 1;
  }
  if (assigned || skipped) await writeAudit({ actor: null, action: "learn.update_run", metadata: { course: opts.courseSlug, assigned, skipped } });
  return { assigned, skipped };
}

// ---- Reminders ------------------------------------------------------------------------------------------------------------------

export type RemindRun = { personNotices: number; leadNotices: number; hrSummaries: number };

/**
 * Daily: a notice to the person at 30 days, 7 days and the due date (each once). Once a week (the first run in each ISO week) the
 * people who are overdue are listed to their lead, and HR gets one count. Names and dates only: never scores, and nothing about
 * attempts. Each notice is claimed with a unique row first, so a repeat run or a missed day never sends twice.
 */
export async function runLearnReminders(today: string, scope?: Scope & { hrUserIds?: string[] }): Promise<RemindRun> {
  // Course names for the wording (an archived add-on with an open assignment still has its name).
  const catalog = await listLearnCourses(db, { includeArchived: true });
  const courseInfo = (slug: string) => catalog.find((c) => c.slug === slug) ?? { slug, label: "Training", noun: "training" };
  const open = await rows<{ id: string; user_id: string; employee_id: string | null; name: string; due_on: string; slug: string }>(sql`
    select a.id, a.user_id, e.id as employee_id, co.slug,
           coalesce(nullif(btrim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), ''), u.email) as name,
           a.due_on::text as due_on
    from learn.assignments a join core.users u on u.id = a.user_id join learn.courses co on co.id = a.course_id
    left join lateral (select * from core.employees x where x.user_id = a.user_id and x.archived_at is null order by x.created_at desc limit 1) e on true
    where a.status in ('assigned', 'in_progress') and u.archived_at is null and (e.id is null or e.status <> 'separated')
      ${onUsers(sql`a.user_id`, scope)}`);

  // Training reminder emails are opt-in: only people who ticked the box get them (the in-app reminders always show).
  const emailOff = new Set<string>(open.map((o) => o.user_id));
  if (open.length) {
    const on = await rows<{ user_id: string }>(sql`
      select user_id from ops.email_preferences where not training_reminder_opt_out and user_id = any(${uuidArray([...new Set(open.map((o) => o.user_id))])}::uuid[])`);
    for (const o of on) emailOff.delete(o.user_id);
  }
  const remindByEmail = async (a: (typeof open)[number], key: string, subject: string, heading: string, line: string) => {
    if (emailOff.has(a.user_id)) return;
    const mail: QueuedEmail = {
      userId: a.user_id,
      kind: "reminder",
      subject,
      heading,
      lines: [line, "Open ELEVATE and choose My training to continue where you stopped."],
      link: "/learn",
      dedupeKey: `learn-reminder:${a.id}:${key}`,
    };
    await queueEmails(db, [mail]);
  };

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
        title: kind === "d0" ? `Your ${courseInfo(a.slug).noun} is due today` : `Your ${courseInfo(a.slug).noun} is ${describeDue(a.due_on, today)}`,
        body: "Open training from the menu to continue where you stopped.",
        link: "/learn",
      });
      await remindByEmail(
        a,
        kind,
        `ELEVATE: your ${courseInfo(a.slug).noun} is ${kind === "d0" ? "due today" : describeDue(a.due_on, today)}`,
        kind === "d0" ? `Your ${courseInfo(a.slug).noun} is due today` : `Your ${courseInfo(a.slug).noun} is ${describeDue(a.due_on, today)}`,
        `It is due on ${a.due_on}. Your progress is saved as you go.`,
      );
      personNotices += 1;
    }
    if (isOverdue(a.due_on, today) && (await claim(a.id, `overdue-${week}`))) {
      newlyOverdue.push(a);
      // The person hears about it too, once a week while it stays overdue.
      const noun = courseInfo(a.slug).noun;
      await notify(db, { userId: a.user_id, kind: "learn.overdue_self", title: `Your ${noun} is overdue`, body: `It was due on ${a.due_on}. Please finish it as soon as you can.`, link: "/learn" });
      await remindByEmail(a, `overdue-${week}`, `ELEVATE: your ${noun} is overdue`, `Your ${noun} is overdue`, `It was due on ${a.due_on}. Please finish it as soon as you can.`);
    }
  }

  // Overdue, once a week: each lead hears about their own people; HR hears one count.
  let leadNotices = 0;
  const byLead = new Map<string, { lead: string; noun: string; names: string[] }>();
  for (const a of newlyOverdue) {
    if (!a.employee_id) continue;
    const chain = await managerChainUserIds(db, a.employee_id);
    const lead = chain[0];
    if (!lead) continue;
    const noun = courseInfo(a.slug).noun;
    const entry = byLead.get(`${lead}|${noun}`) ?? { lead, noun, names: [] };
    entry.names.push(a.name);
    byLead.set(`${lead}|${noun}`, entry);
  }
  for (const { lead, noun, names } of byLead.values()) {
    await notify(db, {
      userId: lead,
      kind: "learn.overdue_team",
      title: names.length === 1 ? `A team member's ${noun} is overdue` : `${names.length} team members' ${noun} is overdue`,
      body: `${names.slice(0, 6).join(", ")}${names.length > 6 ? `, and ${names.length - 6} more` : ""}.`,
      link: "/training",
    });
    leadNotices += 1;
  }

  let hrSummaries = 0;
  if (newlyOverdue.length) {
    const hrIds = scope?.hrUserIds ?? (await hrUserIds());
    const perCourse = new Map<string, number>();
    for (const a of newlyOverdue) perCourse.set(a.slug, (perCourse.get(a.slug) ?? 0) + 1);
    for (const [slug, n] of perCourse) {
      const info = courseInfo(slug);
      for (const hr of hrIds) {
        await notify(db, { userId: hr, kind: "learn.overdue", title: `${n} ${n === 1 ? "person has" : "people have"} overdue ${info.noun}`, body: "See who is behind and what each needs.", link: `/training?course=${info.slug}` });
        hrSummaries += 1;
      }
    }
  }
  return { personNotices, leadNotices, hrSummaries };
}

// ---- Certificates into ELEVATE's Certificates ---------------------------------------------------------------------------------

export type SyncRun = { recorded: number; archived: number; waiting: number; filed: number };

type CertificateRow = { id: string; assignment_id: string; issued_on: string; ends_on: string; title: string; reference: string; holder_name: string };

/** The certificate as a PDF (the emailed copy and the copy filed in the person's Documents are the same file). */
async function renderCertificate(executor: { execute: typeof db.execute }, c: CertificateRow): Promise<Uint8Array> {
  const transcriptRows = (await executor.execute(sql`select learn.certificate_transcript(${c.assignment_id}::uuid) as t`)) as unknown as {
    t: { modules?: { title: string; completedOn: string | null }[]; scorePercent?: number | null; takenOn?: string | null; ipAddress?: string | null } | null;
  }[];
  const transcript = transcriptRows[0]?.t ?? null;
  return renderCertificatePdf({
    modules: transcript?.modules ?? [],
    scorePercent: transcript?.scorePercent ?? null,
    takenOn: transcript?.takenOn ?? null,
    ipAddress: transcript?.ipAddress ?? null,
    holderName: c.holder_name,
    courseTitle: c.title,
    issuedOn: c.issued_on,
    endsOn: c.ends_on,
    reference: c.reference,
    verifyUrl: learnBaseUrl() ? `${learnBaseUrl()}/verify` : "the verify page of ELEVATE Learn",
  });
}

/**
 * Every 30 minutes: a certificate earned in Learn is recorded in Certificates (so the existing expiry reminders, the dashboard and
 * HR's list all work from one place). Idempotent: a certificate is recorded once (learn.certificate_sync), and the credential row is
 * unique per person, name and end date. A revoked certificate archives its credential. A person with no people record is left waiting.
 */
export async function runLearnSync(scope?: Scope): Promise<SyncRun> {
  const todo = await rows<{ id: string; assignment_id: string; user_id: string; issued_on: string; ends_on: string; title: string; reference: string; holder_name: string; employee_id: string | null }>(sql`
    select c.id, c.assignment_id, c.user_id, c.issued_on::text, c.ends_on::text, co.title, c.reference, c.holder_name,
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
      await notify(tx, { userId: c.user_id, kind: "learn.certified", title: "Your training certificate is recorded", body: `${c.title}, valid until ${c.ends_on}. It also appears under Certificates.`, link: "/credentials" });
      // The emailed copy: a PDF of the certificate, attached once (the queue's dedupe key). The email says nothing else.
      const pdf = await renderCertificate(tx, c);
      await queueEmails(tx, [
        {
          userId: c.user_id,
          kind: "invite",
          subject: "Your ELEVATE Learn certificate",
          heading: "Your certificate of completion",
          lines: ["Your certificate is attached as a PDF.", "You can also download it again, or print it, from ELEVATE Learn."],
          link: "/learn",
          attachment: { fileName: `ers-certificate-${c.reference}.pdf`, mimeType: "application/pdf", content: Buffer.from(pdf).toString("base64"), base64: true },
          dedupeKey: `learn-certificate:${c.id}`,
        },
      ]);
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

  // The certificate is also filed in the person's Documents (a copy of the same PDF). This runs for every recorded certificate that has no
  // copy yet, so it also catches up the ones recorded before this existed, a few at a time. A revoked certificate's copy is archived.
  const filed = await fileCertificateCopies(scope);

  if (recorded || archived.length || filed) await writeAudit({ actor: null, action: "learn.sync", metadata: { recorded, archived: archived.length, filed } });
  return { recorded, archived: archived.length, waiting, filed };
}

/** Certificates filed per run: enough to catch up quickly, few enough to keep a run short. */
const FILE_BATCH = 50;

async function fileCertificateCopies(scope?: Scope): Promise<number> {
  const pending = await rows<CertificateRow & { employee_id: string }>(sql`
    select c.id, c.assignment_id, c.issued_on::text, c.ends_on::text, co.title, c.reference, c.holder_name,
           (select e.id from core.employees e where e.user_id = c.user_id and e.archived_at is null order by e.created_at desc limit 1) as employee_id
    from learn.certificates c
    join learn.certificate_sync cs on cs.certificate_id = c.id
    join learn.assignments a on a.id = c.assignment_id join learn.courses co on co.id = a.course_id
    where not exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id)
      and not exists (select 1 from docs.system_documents d where d.source_kind = 'learn_certificate' and d.source_id = c.id)
      ${onUsers(sql`c.user_id`, scope)}
    order by c.created_at limit ${FILE_BATCH}`);
  let filed = 0;
  for (const c of pending) {
    if (!c.employee_id) continue;
    try {
      const pdf = await renderCertificate(db, c);
      const result = await fileSystemDocument({ employeeId: c.employee_id, typeSlug: "training_certificate", title: `${c.title} certificate`, fileName: `ers-certificate-${c.reference}.pdf`, bytes: pdf, sourceKind: "learn_certificate", sourceId: c.id });
      if (result === "filed") filed += 1;
    } catch (error) {
      console.error("filing a certificate failed:", error instanceof Error ? error.name : "unknown error");
    }
  }
  const revoked = await rows<{ id: string }>(sql`select r.certificate_id as id from learn.certificate_revocations r where exists (select 1 from docs.system_documents d where d.source_kind = 'learn_certificate' and d.source_id = r.certificate_id) ${scope?.userIds ? sql`and r.certificate_id in (select id from learn.certificates where user_id = any(${uuidArray(scope.userIds)}::uuid[]))` : sql``}`);
  await archiveSystemDocuments("learn_certificate", revoked.map((r) => r.id));
  return filed;
}

// ---- Clean-up -----------------------------------------------------------------------------------------------------------------

export type PurgeRun = { tokens: number; sessions: number; answers: number; callSteps: number };

/**
 * Daily: removes finished sign-in tokens and sessions, and per-question exam answers and mock-call picks 12 months after the exam or call was submitted. The
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
    // the mock call's picks follow the same rule (the attempt, its score and category percentages stay six years)
    const callSteps = (await tx.execute(sql`
      delete from learn.call_attempt_steps where attempt_id in (select id from learn.call_attempts where status = 'submitted' and submitted_at < now() - interval '12 months')
      returning 1`)) as unknown as unknown[];
    return { tokens: tokens.length, sessions: sessions.length, answers: answers.length, callSteps: callSteps.length };
  });
}
