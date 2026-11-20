import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for the count queries behind the recruiter and admin dashboard tiles. The test database is shared with other
// tests, so every assertion compares against a baseline read before this test's rows are added.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const recruiting = await import("@/modules/recruiting/queries");
const manager = await import("@/modules/dashboard/manager-queries");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
let counter = 0;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${label}${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

async function makeApplication(title: string, createdBy: string) {
  const [opening] = await rows<{ id: string }>(sql`insert into talent.job_openings (title, description, status) values (${title}, 'x', 'open') returning id`);
  const [candidate] = await rows<{ id: string }>(sql`insert into talent.candidates (email, full_name) values (${`c${counter++}${Date.now()}@example.com`}, 'Fake Person') returning id`);
  const [application] = await rows<{ id: string }>(sql`insert into talent.applications (opening_id, candidate_id) values (${opening.id}, ${candidate.id}) returning id`);
  return { openingId: opening.id, applicationId: application.id, createdBy };
}

describe("recruiter tile queries", () => {
  it("lists only scheduled interviews from today on, soonest first, limited, and marks a started one without a scorecard", async () => {
    const recruiter = await makeUser("rec", ["recruiter"]);
    const a = await makeApplication(`Dash Intake ${Date.now()}`, recruiter.id);
    const insert = (offset: string, status = "scheduled") =>
      db.execute(sql`insert into talent.interviews (application_id, starts_at, minutes, location, created_by, status) values (${a.applicationId}, now() + ${offset}::interval, 30, 'online', ${recruiter.id}, ${status})`);
    await insert("-30 hours");
    await insert("2 days");
    await insert("1 day");
    await insert("3 days", "cancelled");
    as(recruiter);
    const list = await recruiting.getUpcomingInterviews(10);
    const mine = list.filter((i) => i.title.startsWith("Dash Intake"));
    expect(mine).toHaveLength(2);
    expect(mine[0].startsAt.getTime()).toBeLessThan(mine[1].startsAt.getTime());
    expect(mine.every((i) => i.scorecardDue === false)).toBe(true);
    expect((await recruiting.getUpcomingInterviews(1)).length).toBeLessThanOrEqual(1);
  });

  it("counts offers by where their signing envelope stands", async () => {
    const recruiter = await makeUser("rec2", ["recruiter"]);
    as(recruiter);
    const before = await recruiting.getOffersPending();
    const a = await makeApplication(`Dash Offers ${Date.now()}`, recruiter.id);
    const envelope = async (status: string, expiresAt: string | null) => {
      const [e] = await rows<{ id: string }>(sql`insert into docs.esign_envelopes (title, created_by, original_path, original_name, original_sha256, page_count, status, expires_at) values ('Offer', ${recruiter.id}, 'p', 'n', 'h', 1, ${status}, ${expiresAt}::timestamptz) returning id`);
      await db.execute(sql`insert into talent.offers (application_id, template_name, fields, rendered_body, created_by, envelope_id) values (${a.applicationId}, 't', '{}'::jsonb, 'b', ${recruiter.id}, ${e.id})`);
    };
    await envelope("out", null);
    await envelope("out", new Date(Date.now() + 2 * 86_400_000).toISOString());
    await envelope("declined", null);
    const after = await recruiting.getOffersPending();
    expect(after.awaitingSignature - before.awaitingSignature).toBe(2);
    expect(after.expiringSoon - before.expiringSoon).toBe(1);
    expect(after.declined - before.declined).toBe(1);
  });
});

describe("admin tile queries", () => {
  it("counts pending invitations, role changes, MFA resets, exports, sensitive views and imports without reading any content", async () => {
    const admin = await makeUser("adm", ["super_admin"]);
    as(admin);
    const [accessBefore, auditBefore] = [await manager.getAccessCounts(), await manager.getAuditHighlights()];

    await db.execute(sql`insert into core.invitations (email, expires_at) values (${`pend${Date.now()}@example.com`}, now() + interval '2 days')`);
    await db.execute(sql`insert into core.invitations (email, expires_at) values (${`old${Date.now()}@example.com`}, now() - interval '2 days')`);
    await db.execute(sql`insert into core.invitations (email, expires_at, accepted_at) values (${`done${Date.now()}@example.com`}, now() + interval '2 days', now())`);
    const audit = (action: string) => db.execute(sql`insert into ops.audit_log (action, after) values (${action}, ${JSON.stringify({ secret: "never read" })}::jsonb)`);
    await audit("roles.update");
    await audit("user.mfa_reset");
    await audit("hours.export");
    await audit("sensitive.view");
    await audit("import.stage");
    await audit("auth.login");

    const [access, highlights] = [await manager.getAccessCounts(), await manager.getAuditHighlights()];
    expect(access.invitationsPending - accessBefore.invitationsPending).toBe(1);
    expect(access.roleChangesWeek - accessBefore.roleChangesWeek).toBe(1);
    expect(access.mfaResetsWeek - accessBefore.mfaResetsWeek).toBe(1);
    expect(highlights.exportsWeek - auditBefore.exportsWeek).toBe(1);
    expect(highlights.sensitiveViewsWeek - auditBefore.sensitiveViewsWeek).toBe(1);
    expect(highlights.importsWeek - auditBefore.importsWeek).toBe(1);
    expect(JSON.stringify(highlights)).not.toContain("never read");
  });
});

describe("training compliance tile query", () => {
  it("does not count a person whose only assignment was cancelled as assigned or as not current", async () => {
    const admin = await makeUser("tc", ["super_admin"]);
    as(admin);
    const slug = `dash-tc-${Date.now().toString(36)}${counter++}`;
    const [c] = await rows<{ id: string }>(sql`insert into learn.courses (slug, title) values (${slug}, 'Dashboard test course') returning id`);
    const [v] = await rows<{ id: string }>(sql`insert into learn.course_versions (course_id, version, exam_config) values (${c.id}, 1, '{}'::jsonb) returning id`);
    const course = { course_id: c.id, version_id: v.id };
    const learn = await import("@/modules/learn/queries");
    const before = await learn.getTrainingCompliance();

    const person = async (label: string) => {
      const u = await makeUser(label, ["employee"]);
      const [a] = await rows<{ id: string }>(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${u.id}, ${course.course_id}, ${course.version_id}, 'full', 'manual', current_date + 30) returning id`);
      return { user: u, assignmentId: a.id };
    };
    const cancelled = await person("tcc");
    await db.execute(sql`update learn.assignments set status = 'cancelled' where id = ${cancelled.assignmentId}`);
    const afterCancelled = await learn.getTrainingCompliance();
    expect(afterCancelled.assigned - before.assigned).toBe(0);
    expect(afterCancelled.overdue - before.overdue).toBe(0);

    await person("tco");
    const afterOpen = await learn.getTrainingCompliance();
    expect(afterOpen.assigned - before.assigned).toBe(1);
  });
});
