import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./global-setup";

// "Everyone on the latest version": unfinished assignments on an older version are ended and replaced by one on the latest version with the
// same due date and track; a dry run changes nothing; finished work, other courses and people already on the latest version are left alone.

const admin = postgres(testDatabaseUrl(process.env.TEST_DB_ADMIN_URL!), { max: 2, onnotice: () => {} });
const { loadCourse, assignCourse } = await import("@/modules/learn/publish");
const { upgradeOpenAssignments } = await import("@/modules/learn/upgrade");
const { COURSES } = await import("../../../learn/src/content");

afterAll(async () => {
  await admin.end();
});

const slug = `upgrade-test-${Date.now().toString(36)}`;
let n = 0;
async function makeUser(label: string) {
  const id = randomUUID();
  await admin`insert into core.users (id, email) values (${id}, ${`${label}${Date.now().toString(36)}${n++}@example.com`})`;
  return id;
}

describe("moving unfinished assignments to the latest version", () => {
  it("replaces an older open assignment with one on the latest version, same due date, and leaves the rest alone", async () => {
    const reviewer = await makeUser("rev");
    const src = COURSES.cybersecurity;
    const publish = async (change: boolean) => {
      const content = structuredClone(src.content);
      if (change) content.modules[0].summary = "A new summary that says something different about this module.";
      return loadCourse(admin, { course: { slug, content, questions: structuredClone(src.questions), examConfig: src.examConfig }, publish: true, reviewerUserId: reviewer, counselApprovedOn: "2026-10-23", actorUserId: reviewer });
    };
    const v1 = await publish(false);

    const started = await makeUser("started");
    const fresh = await makeUser("fresh");
    const passed = await makeUser("passed");
    const a1 = await assignCourse(admin, { userId: started, track: "full", courseSlug: slug, dueOn: "2026-11-13" });
    const a2 = await assignCourse(admin, { userId: fresh, track: "essentials", courseSlug: slug, dueOn: "2026-11-20" });
    const a3 = await assignCourse(admin, { userId: passed, track: "full", courseSlug: slug });
    await admin`update learn.assignments set status = 'in_progress' where id in (${a1.assignmentId}, ${a3.assignmentId})`;
    await admin`update learn.assignments set status = 'passed', passed_at = now() where id = ${a3.assignmentId}`;
    const [mod] = await admin`select module_key from learn.version_modules where version_id = ${v1.versionId} order by position limit 1`;
    await admin`insert into learn.module_completions (assignment_id, user_id, module_key) values (${a1.assignmentId}, ${started}, ${mod.module_key})`;

    // nothing to do while everyone is on the latest version
    const none = await upgradeOpenAssignments(admin, { courseSlug: slug, dryRun: false });
    expect(none.rows).toHaveLength(0);

    const v2 = await publish(true);
    expect(v2.version).toBe(2);

    // a dry run lists and changes nothing
    const dry = await upgradeOpenAssignments(admin, { courseSlug: slug, dryRun: true });
    expect(dry.latestVersion).toBe(2);
    expect(dry.rows.map((r) => r.userId).sort()).toEqual([started, fresh].sort());
    expect(dry.rows.find((r) => r.userId === started)).toMatchObject({ fromVersion: 1, modulesDone: 1, dueOn: "2026-11-13", track: "full" });
    expect(dry.rows.find((r) => r.userId === fresh)).toMatchObject({ modulesDone: 0, dueOn: "2026-11-20", track: "essentials" });
    expect(dry.moved).toBe(0);
    const [still] = await admin`select status from learn.assignments where id = ${a1.assignmentId}`;
    expect(still.status).toBe("in_progress");

    // the real run
    const run = await upgradeOpenAssignments(admin, { courseSlug: slug, dryRun: false });
    expect(run.moved).toBe(2);
    const old = await admin`select id, status from learn.assignments where id in (${a1.assignmentId}, ${a2.assignmentId}, ${a3.assignmentId}) order by id`;
    expect(old.find((r) => r.id === a1.assignmentId)!.status).toBe("cancelled");
    expect(old.find((r) => r.id === a2.assignmentId)!.status).toBe("cancelled");
    expect(old.find((r) => r.id === a3.assignmentId)!.status).toBe("passed"); // finished work is history
    const open = await admin`
      select a.user_id, a.track, a.due_on::text as due_on, a.status, v.version from learn.assignments a join learn.course_versions v on v.id = a.version_id
      where a.user_id in (${started}, ${fresh}) and a.status in ('assigned', 'in_progress')`;
    expect(open).toHaveLength(2);
    expect(open.every((r) => r.version === 2 && r.status === "assigned")).toBe(true);
    expect(open.find((r) => r.user_id === started)).toMatchObject({ track: "full", due_on: "2026-11-13" });
    expect(open.find((r) => r.user_id === fresh)).toMatchObject({ track: "essentials", due_on: "2026-11-20" });
    expect((await admin`select 1 from ops.notifications where user_id = ${started} and kind = 'learn.upgraded'`).length).toBe(1);

    // asking again finds nobody
    expect((await upgradeOpenAssignments(admin, { courseSlug: slug, dryRun: false })).rows).toHaveLength(0);
    // the audit entry carries counts, never names
    const [audit] = await admin`select metadata::text as m from ops.audit_log where action = 'learn.upgrade_run' order by id desc limit 1`;
    expect(audit.m).toContain('"moved": 2');
    expect(audit.m).not.toContain("@");
  });
});
