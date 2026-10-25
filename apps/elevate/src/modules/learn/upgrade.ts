import type postgres from "postgres";

// Moves people who are partway through an OLDER version of a course to the latest published one. Normally a person finishes the version they
// started, and the short update brings them up to date afterwards. When the owner wants everyone on the latest lessons at once, this ends each
// unfinished older assignment and gives the person the latest version with the SAME due date and track. Progress on the old assignment is not
// carried over (the screens differ between versions), so the dry run lists how many modules each person had finished before anyone is moved.
// The old assignment stays as history (status cancelled); nothing is deleted. Run by scripts/learn-upgrade.mts.

type Sql = postgres.Sql;

export type UpgradeRow = {
  assignmentId: string;
  userId: string;
  email: string | null;
  track: string;
  reason: string;
  dueOn: string;
  fromVersion: number;
  modulesDone: number;
};

export type UpgradeResult = { courseSlug: string; latestVersion: number; dryRun: boolean; rows: UpgradeRow[]; moved: number };

export async function upgradeOpenAssignments(sql: Sql, o: { courseSlug: string; dryRun: boolean }): Promise<UpgradeResult> {
  const [latest] = await sql`
    select v.id, v.version, v.course_id from learn.course_versions v join learn.courses c on c.id = v.course_id
    where c.slug = ${o.courseSlug} and v.status = 'published'`;
  if (!latest) throw new Error(`The ${o.courseSlug} course is not published yet.`);

  // An 'update' assignment is already on the latest version (it is created from it), so it never matches the version test below.
  const found = await sql`
    select a.id, a.user_id, u.email, a.track, a.reason, a.due_on::text as due_on, v.version,
           (select count(*) from learn.module_completions c where c.assignment_id = a.id)::int as modules_done
    from learn.assignments a
    join learn.course_versions v on v.id = a.version_id
    left join core.users u on u.id = a.user_id
    where a.course_id = ${latest.course_id} and a.status in ('assigned', 'in_progress') and a.version_id <> ${latest.id}
    order by v.version, u.email`;
  const rows: UpgradeRow[] = found.map((r) => ({
    assignmentId: r.id as string,
    userId: r.user_id as string,
    email: (r.email as string | null) ?? null,
    track: r.track as string,
    reason: r.reason as string,
    dueOn: r.due_on as string,
    fromVersion: r.version as number,
    modulesDone: r.modules_done as number,
  }));
  if (o.dryRun || rows.length === 0) return { courseSlug: o.courseSlug, latestVersion: latest.version as number, dryRun: o.dryRun, rows, moved: 0 };

  let moved = 0;
  for (const r of rows) {
    await sql.begin(async (transaction) => {
      const tx = transaction as unknown as Sql;
      // end the old one first (one open assignment per person and course), then give the latest version with the same due date
      const closed = await tx`
        update learn.assignments set status = 'cancelled', closed_at = now()
        where id = ${r.assignmentId} and status in ('assigned', 'in_progress') returning id`;
      if (closed.length === 0) return; // it changed while this ran: leave it alone
      await tx`
        insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on, created_by)
        values (${r.userId}, ${latest.course_id}, ${latest.id}, ${r.track}, ${r.reason}, ${r.dueOn}::date, null)`;
      await tx`
        insert into ops.notifications (user_id, kind, title, body, link)
        values (${r.userId}, 'learn.upgraded', 'Your training has been updated to the latest version',
                'The lessons were improved, so you now have the newest version of this course. Your due date has not changed.', '/learn')`;
      moved += 1;
    });
  }
  // counts only: no names or emails in the audit log
  await sql`
    insert into ops.audit_log (action, target_type, metadata)
    values ('learn.upgrade_run', 'learn_course', ${sql.json({ course: o.courseSlug, toVersion: latest.version as number, moved })})`;
  return { courseSlug: o.courseSlug, latestVersion: latest.version as number, dryRun: false, rows, moved };
}
