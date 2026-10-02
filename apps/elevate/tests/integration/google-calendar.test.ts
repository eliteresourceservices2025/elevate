import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PDF_BYTES } from "./fake-storage";

// Real-database tests for Google Calendar interviews (Phase 3.1b) against a fake Google: connecting, an encrypted token, events on the
// scheduler's own calendar with a Meet link, the .ics fallback, reconnect handling, cancelling, disconnecting. Never calls Google.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.30" }) }));

const { db } = await import("@/lib/db");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const actions = await import("@/modules/recruiting/actions");
const queries = await import("@/modules/recruiting/queries");
const service = await import("@/modules/recruiting/service");
const calendar = await import("@/modules/recruiting/calendar");
const { GoogleError, googleEventIdFor, buildCalendarEvent, setGoogleClient } = await import("@/modules/recruiting/google");
type GoogleCalendarClient = import("@/modules/recruiting/google").GoogleCalendarClient;
type CalendarEventInput = import("@/modules/recruiting/google").CalendarEventInput;

type TestUser = { id: string; email: string; roles: RoleSlug[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const asActor = (u: TestUser) => ({ id: u.id, email: u.email, roles: u.roles });
const idOf = (r: { ok: boolean; data?: { id: string }; error?: string }) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data!.id;
};

class FakeGoogle implements GoogleCalendarClient {
  isConfigured = true;
  created: { token: string; event: CalendarEventInput }[] = [];
  deleted: { token: string; eventId: string }[] = [];
  revoked: string[] = [];
  createError: InstanceType<typeof GoogleError> | null = null;
  deleteError: InstanceType<typeof GoogleError> | null = null;
  afterCreate: (() => Promise<void>) | null = null;
  configured() {
    return this.isConfigured;
  }
  authUrl(state: string, redirectUri: string) {
    return `https://accounts.example/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }
  async exchangeCode(code: string) {
    return { refreshToken: `rt-secret-${code}`, email: `${code}@gmail.example` };
  }
  async createEvent(token: string, event: CalendarEventInput) {
    if (this.createError) throw this.createError;
    this.created.push({ token, event });
    if (this.afterCreate) await this.afterCreate();
    return { eventId: event.eventId, meetLink: `https://meet.google.example/${event.eventId.slice(-6)}` };
  }
  async deleteEvent(token: string, eventId: string) {
    if (this.deleteError) throw this.deleteError;
    this.deleted.push({ token, eventId });
  }
  async revoke(token: string) {
    this.revoked.push(token);
  }
}
const google = new FakeGoogle();
const fake = new FakeStorage();

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

let recruiter: TestUser;
let recruiter2: TestUser;
let hr: TestUser;
let lead: TestUser;
let employee: TestUser;

async function setup() {
  as(recruiter);
  const opening = idOf(await actions.saveOpening({ title: uniq("Cal VA "), description: "Support our clients with scheduling and inbox care.", hiringTeamUserIds: [lead.id] }));
  await actions.setOpeningStatus({ id: opening, status: "open" });
  const email = `${uniq("cand")}@example.com`;
  expect(await service.submitApplication({ openingId: opening, fullName: "Ana Reyes", email, consent: true, website: "" }, { bytes: PDF_BYTES, name: "cv.pdf" })).toEqual({ ok: true });
  const [app] = await rows<{ id: string }>(sql`select a.id from talent.applications a join talent.candidates c on c.id = a.candidate_id where lower(c.email) = ${email}`);
  return { opening, email, appId: app.id };
}
const schedule = (who: TestUser, appId: string, extra: Record<string, unknown> = {}) => {
  as(who);
  return actions.scheduleInterview({ applicationId: appId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), minutes: 45, location: "Google Meet", interviewerUserIds: [lead.id], emailCandidate: true, ...extra });
};
const connect = async (u: TestUser, code = "code") => calendar.completeConnection(asActor(u), code);

beforeAll(async () => {
  setDocumentStorage(fake);
  setGoogleClient(google);
  recruiter = await makeUser("rec", ["recruiter", "employee"]);
  recruiter2 = await makeUser("rec2", ["recruiter", "employee"]);
  hr = await makeUser("hr", ["hr_admin", "employee"]);
  lead = await makeUser("lead", ["team_lead", "employee"]);
  employee = await makeUser("emp", ["employee"]);
});
afterAll(() => setGoogleClient(undefined));

describe("connecting", () => {
  it("stores the connection with the refresh token encrypted, audits it, and reports it", async () => {
    await connect(recruiter, "alice");
    const [row] = await rows<{ google_email: string; refresh_token_enc: string; needs_reconnect: boolean }>(sql`select google_email, refresh_token_enc, needs_reconnect from talent.calendar_connections where user_id = ${recruiter.id}`);
    expect(row.google_email).toBe("alice@gmail.example");
    expect(row.refresh_token_enc).not.toContain("rt-secret");
    expect(row.refresh_token_enc.length).toBeGreaterThan(20);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.calendar_connect' and target_id = ${recruiter.id}`)).toHaveLength(1);
    as(recruiter);
    expect(await queries.getCalendarCard()).toEqual({ configured: true, connected: true, email: "alice@gmail.example", needsReconnect: false });
    // The audit row names the account but never the token
    const audit = JSON.stringify(await rows(sql`select after, metadata from ops.audit_log where action = 'recruiting.calendar_connect'`));
    expect(audit).not.toContain("rt-secret");
  });

  it("is only for HR, Super Admin and recruiters, for themselves", async () => {
    await expect(calendar.completeConnection(asActor(lead), "x")).rejects.toThrow("Forbidden");
    await expect(calendar.completeConnection(asActor(employee), "x")).rejects.toThrow("Forbidden");
    await connect(hr, "hana");
    as(lead);
    await expect(queries.getCalendarCard()).rejects.toThrow("Forbidden");
    expect(await actions.disconnectCalendar()).toEqual({ ok: false, error: "You do not have access to do that." });
  });

  it("checks the one-time state value in constant time and refuses anything else", () => {
    expect(calendar.sameState("abc123", "abc123")).toBe(true);
    expect(calendar.sameState("abc123", "abc124")).toBe(false);
    expect(calendar.sameState("abc123", "abc1234")).toBe(false);
    expect(calendar.sameState(undefined, "abc123")).toBe(false);
    expect(calendar.sameState("abc123", null)).toBe(false);
    expect(calendar.newState()).not.toBe(calendar.newState());
  });

  it("says it is not set up when there are no Google credentials", async () => {
    google.isConfigured = false;
    setGoogleClient(null);
    as(recruiter);
    expect((await queries.getCalendarCard()).configured).toBe(false);
    setGoogleClient(google);
    google.isConfigured = true;
  });
});

describe("scheduling", () => {
  it("creates the event on the scheduler's own calendar with a Meet link, invites everyone through Google and sends no .ics", async () => {
    await connect(recruiter, "alice");
    const { appId, email } = await setup();
    google.created.length = 0;
    const result = await schedule(recruiter, appId);
    expect(result.ok).toBe(true);
    const data = (result as { data: { id: string; calendar: string; meetLink: string | null; warning: string | null } }).data;
    expect(data).toMatchObject({ calendar: "google", warning: null });
    expect(data.meetLink).toContain("meet.google.example");

    expect(google.created).toHaveLength(1);
    const { token, event } = google.created[0];
    expect(token).toBe("rt-secret-alice"); // decrypted for the call, the scheduler's own token
    expect(event.eventId).toBe(googleEventIdFor(data.id));
    expect(event.attendeeEmails.sort()).toEqual([lead.email, email].sort());
    expect(event.summary).toMatch(/^Interview: /);
    expect(event.summary).not.toContain("Ana"); // the applicant's name is not in the event title

    const [iv] = await rows<{ calendar_mode: string; google_event_id: string; meet_link: string; calendar_user_id: string }>(sql`select calendar_mode, google_event_id, meet_link, calendar_user_id from talent.interviews where id = ${data.id}`);
    expect(iv).toMatchObject({ calendar_mode: "google", google_event_id: googleEventIdFor(data.id), calendar_user_id: recruiter.id });
    expect(iv.meet_link).toBe(data.meetLink);
    // Google sends the invites, so ELEVATE sends none of its own, but the interviewers are still notified in the app
    expect(await rows(sql`select 1 from ops.email_queue where dedupe_key = ${`interview:${data.id}`}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from talent.candidate_emails where dedupe_key = ${`interview:${data.id}`}`)).toHaveLength(0);
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${lead.id} and kind = 'recruiting.interview' and link = ${`/recruiting/applications/${appId}`}`)).length).toBe(1);

    // The page data carries the Meet link
    as(recruiter);
    const view = (await queries.getApplication(appId)).interviews[0];
    expect(view).toMatchObject({ calendarMode: "google", meetLink: data.meetLink });
  });

  it("keeps using .ics emails for someone who has not connected, and never borrows another person's connection", async () => {
    await connect(recruiter, "alice");
    const { appId } = await setup();
    google.created.length = 0;
    const result = await schedule(recruiter2, appId); // recruiter2 never connected
    const data = (result as { data: { id: string; calendar: string; warning: string | null } }).data;
    expect(data).toMatchObject({ calendar: "ics", warning: null });
    expect(google.created).toHaveLength(0);
    expect(await rows(sql`select 1 from ops.email_queue where dedupe_key = ${`interview:${data.id}`}`)).toHaveLength(1);
    expect(await rows(sql`select 1 from talent.candidate_emails where dedupe_key = ${`interview:${data.id}`}`)).toHaveLength(1);
  });

  it("falls back to .ics with a warning when Google is down, and stays connected", async () => {
    await connect(recruiter, "alice");
    const { appId } = await setup();
    google.createError = new GoogleError("unavailable", "down");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await schedule(recruiter, appId);
    google.createError = null;
    const data = (result as { data: { id: string; calendar: string; warning: string | null } }).data;
    expect(data.calendar).toBe("ics");
    expect(data.warning).toContain("could not be reached");
    expect(await rows(sql`select 1 from ops.email_queue where dedupe_key = ${`interview:${data.id}`}`)).toHaveLength(1);
    as(recruiter);
    expect((await queries.getCalendarCard()).needsReconnect).toBe(false);
  });

  it("flags a revoked or expired connection for reconnecting, falls back to .ics, and a reconnect clears it", async () => {
    await connect(recruiter, "alice");
    const { appId } = await setup();
    google.createError = new GoogleError("reconnect", "invalid_grant");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = (await schedule(recruiter, appId)) as { data: { calendar: string; warning: string } };
    google.createError = null;
    expect(first.data.calendar).toBe("ics");
    expect(first.data.warning).toContain("Reconnect");
    as(recruiter);
    expect((await queries.getCalendarCard()).needsReconnect).toBe(true);

    // Until they reconnect, Google is not even tried
    google.created.length = 0;
    const second = (await schedule(recruiter, appId)) as { data: { calendar: string; warning: string } };
    expect(second.data).toMatchObject({ calendar: "ics" });
    expect(second.data.warning).toContain("renewed");
    expect(google.created).toHaveLength(0);

    await connect(recruiter, "alice2");
    as(recruiter);
    expect((await queries.getCalendarCard()).needsReconnect).toBe(false);
    const third = (await schedule(recruiter, appId)) as { data: { calendar: string } };
    expect(third.data.calendar).toBe("google");
  });

  it("removes the Google event again if the interview could not be saved", async () => {
    await connect(recruiter, "alice");
    const { appId } = await setup();
    google.created.length = 0;
    google.deleted.length = 0;
    // The application is closed by someone else between the event being created and the interview being saved
    google.afterCreate = async () => {
      await db.execute(sql`update talent.applications set stage = 'rejected', close_kind = 'rejected', closed_at = now() where id = ${appId}`);
    };
    const result = await schedule(recruiter, appId);
    google.afterCreate = null;
    expect(result.ok).toBe(false);
    expect(google.created).toHaveLength(1);
    expect(google.deleted.map((d) => d.eventId)).toEqual([google.created[0].event.eventId]);
    expect(await rows(sql`select 1 from talent.interviews where application_id = ${appId}`)).toHaveLength(0);
  });
});

describe("cancelling and disconnecting", () => {
  it("cancelling a Google interview removes the event (Google tells the guests) and sends no .ics", async () => {
    await connect(recruiter, "alice");
    const { appId } = await setup();
    const id = idOf(await schedule(recruiter, appId));
    google.deleted.length = 0;
    as(recruiter);
    expect(await actions.cancelInterview({ interviewId: id })).toEqual({ ok: true, data: { warning: null } });
    expect(google.deleted).toEqual([{ token: "rt-secret-alice", eventId: googleEventIdFor(id) }]);
    expect(await rows(sql`select 1 from ops.email_queue where dedupe_key = ${`interview-cancel:${id}`}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from talent.candidate_emails where dedupe_key = ${`interview-cancel:${id}`}`)).toHaveLength(0);
    expect((await rows<{ status: string }>(sql`select status from talent.interviews where id = ${id}`))[0].status).toBe("cancelled");
  });

  it("still cancels when Google cannot remove the event, and says to delete it by hand", async () => {
    await connect(recruiter, "alice");
    const { appId } = await setup();
    const id = idOf(await schedule(recruiter, appId));
    google.deleteError = new GoogleError("unavailable", "down");
    as(hr); // another HR admin cancels: the event is removed from the organizer's calendar, using the organizer's connection
    const result = await actions.cancelInterview({ interviewId: id });
    google.deleteError = null;
    expect(result).toMatchObject({ ok: true, data: { warning: expect.stringContaining("Delete it in Google Calendar") } });
    expect((await rows<{ status: string }>(sql`select status from talent.interviews where id = ${id}`))[0].status).toBe("cancelled");
  });

  it("an .ics interview is cancelled with email files as before", async () => {
    const { appId } = await setup();
    const id = idOf(await schedule(recruiter2, appId));
    as(recruiter2);
    expect(await actions.cancelInterview({ interviewId: id })).toEqual({ ok: true, data: { warning: null } });
    expect(await rows(sql`select 1 from ops.email_queue where dedupe_key = ${`interview-cancel:${id}`}`)).toHaveLength(1);
  });

  it("disconnecting revokes the permission at Google and deletes the stored token", async () => {
    await connect(recruiter, "bye");
    google.revoked.length = 0;
    as(recruiter);
    expect(await actions.disconnectCalendar()).toEqual({ ok: true, data: undefined });
    expect(google.revoked).toEqual(["rt-secret-bye"]);
    expect(await rows(sql`select 1 from talent.calendar_connections where user_id = ${recruiter.id}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.calendar_disconnect' and target_id = ${recruiter.id}`)).not.toHaveLength(0);
    as(recruiter);
    expect((await queries.getCalendarCard()).connected).toBe(false);
    expect(await actions.disconnectCalendar()).toEqual({ ok: true, data: undefined }); // harmless when already disconnected
  });
});

describe("the event itself", () => {
  it("builds a UTC event with a Meet request, unique guests and no guest permissions", () => {
    const body = buildCalendarEvent({ eventId: "elvabc123", summary: "Interview: VA", description: "Bring ID", location: "Google Meet", startsAt: new Date("2026-11-03T14:00:00Z"), minutes: 45, attendeeEmails: ["A@Example.com", "a@example.com", "b@example.com"] });
    expect(body.start).toEqual({ dateTime: "2026-11-03T14:00:00.000Z", timeZone: "UTC" });
    expect(body.end.dateTime).toBe("2026-11-03T14:45:00.000Z");
    expect(body.attendees).toEqual([{ email: "a@example.com" }, { email: "b@example.com" }]);
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
    expect(body.guestsCanModify).toBe(false);
    expect(body.guestsCanInviteOthers).toBe(false);
  });
  it("makes a Google-valid event id from the interview id (lowercase a-v and digits)", () => {
    expect(googleEventIdFor("0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d")).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});
