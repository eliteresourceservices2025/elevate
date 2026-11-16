import { describe, expect, it } from "vitest";
import { clientFor, desiredEvents, planImport, type ClientMapping, type JibbleTimeEntry } from "./import-rules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const t = (h: number, m = 0) => Date.UTC(2026, 10, 11, h, m);
const entry = (id: string, type: JibbleTimeEntry["type"], at: number, over: Partial<JibbleTimeEntry> = {}): JibbleTimeEntry => ({ id, type, timeMs: at, projectId: null, activityId: null, ...over });
const none: ClientMapping = { activity: new Map(), project: new Map(), only: null };
const mapping = (over: Partial<ClientMapping> = {}): ClientMapping => ({ ...none, ...over });
const out = { state: "out" as const, clientId: null };

describe("which client a Jibble entry means", () => {
  it("prefers the activity, then the project, then the person's only client", () => {
    const m = mapping({ activity: new Map([["act", A]]), project: new Map([["proj", B]]), only: B });
    expect(clientFor({ projectId: "proj", activityId: "act" }, m).clientId).toBe(A);
    expect(clientFor({ projectId: "proj", activityId: "nope" }, m).clientId).toBe(B);
    expect(clientFor({ projectId: null, activityId: null }, m).clientId).toBe(B);
  });

  it("has no client when nothing is mapped, and says which ids are unmapped", () => {
    const r = clientFor({ projectId: "proj", activityId: "act" }, none);
    expect(r.clientId).toBeNull();
    expect(r.unmapped).toEqual([{ kind: "activity", id: "act" }, { kind: "project", id: "proj" }]);
    expect(clientFor({ projectId: null, activityId: null }, none).unmapped).toEqual([]);
  });
});

describe("the events a day of Jibble entries stands for", () => {
  it("turns in, start break, in, out into clock in, break, end of break, clock out", () => {
    const { events } = desiredEvents([entry("e1", "In", t(9)), entry("e2", "StartBreak", t(12)), entry("e3", "In", t(12, 30)), entry("e4", "Out", t(17))], out, mapping({ only: A }));
    expect(events.map((e) => [e.type, e.atMs, e.clientId])).toEqual([
      ["clock_in", t(9), A],
      ["break_start", t(12), null],
      ["break_end", t(12, 30), null],
      ["clock_out", t(17), null],
    ]);
  });

  it("reads an In with another project while working as a switch of client, and the same project as nothing", () => {
    const m = mapping({ project: new Map([["pa", A], ["pb", B]]) });
    const { events } = desiredEvents([entry("e1", "In", t(9), { projectId: "pa" }), entry("e2", "In", t(11), { projectId: "pa" }), entry("e3", "In", t(13), { projectId: "pb" }), entry("e4", "Out", t(17))], out, m);
    expect(events.map((e) => [e.type, e.clientId])).toEqual([["clock_in", A], ["switch_client", B], ["clock_out", null]]);
  });

  it("ends a break before the clock-out when an Out arrives on a break", () => {
    const { events } = desiredEvents([entry("e1", "In", t(9)), entry("e2", "StartBreak", t(12)), entry("e3", "Out", t(13))], out, none);
    expect(events.map((e) => e.type)).toEqual(["clock_in", "break_start", "break_end", "clock_out"]);
    expect(events[2].atMs).toBe(events[3].atMs);
  });

  it("ignores what does not fit: an Out when out, a break when out", () => {
    expect(desiredEvents([entry("e1", "Out", t(9)), entry("e2", "StartBreak", t(10))], out, none).events).toEqual([]);
  });

  it("starts from the state the person was already in", () => {
    const working = { state: "working" as const, clientId: A };
    const { events } = desiredEvents([entry("e1", "Out", t(9))], working, none);
    expect(events.map((e) => e.type)).toEqual(["clock_out"]);
  });

  it("reports ids that have no client", () => {
    expect(desiredEvents([entry("e1", "In", t(9), { projectId: "p1" })], out, none).unmapped).toEqual([{ kind: "project", id: "p1" }]);
  });
});

describe("what to change to match Jibble", () => {
  const ev = (entryId: string, type: string, atMs: number, over: { id?: string; voided?: boolean; clientId?: string | null } = {}) => ({ id: over.id ?? `id-${entryId}-${type}`, entryId, type, atMs, clientId: over.clientId ?? null, voided: over.voided ?? false });
  const want = (entryId: string, type: "clock_in" | "clock_out", atMs: number, clientId: string | null = null) => ({ type, atMs, entryId, clientId });

  it("adds what is new and leaves what is the same", () => {
    const plan = planImport([want("e1", "clock_in", t(9)), want("e2", "clock_out", t(17))], [ev("e1", "clock_in", t(9))]);
    expect(plan.toInsert).toEqual([want("e2", "clock_out", t(17))]);
    expect(plan.toVoid).toEqual([]);
  });

  it("voids an event whose entry was deleted, and replaces one whose time was edited", () => {
    const plan = planImport([want("e1", "clock_in", t(9, 30))], [ev("e1", "clock_in", t(9)), ev("gone", "clock_out", t(17))]);
    expect(plan.toInsert).toEqual([want("e1", "clock_in", t(9, 30))]);
    expect(plan.toVoid.sort()).toEqual(["id-e1-clock_in", "id-gone-clock_out"].sort());
  });

  it("re-attributes the day when the client of an entry changes", () => {
    const plan = planImport([want("e1", "clock_in", t(9), A)], [ev("e1", "clock_in", t(9), { clientId: null })]);
    expect(plan.toInsert).toEqual([want("e1", "clock_in", t(9), A)]);
    expect(plan.toVoid).toEqual(["id-e1-clock_in"]);
  });

  it("does not add an event again that was voided and still says the same, and does not void it twice", () => {
    const plan = planImport([want("e1", "clock_in", t(9))], [ev("e1", "clock_in", t(9), { voided: true })]);
    expect(plan).toEqual({ toInsert: [], toVoid: [] });
    expect(planImport([], [ev("e1", "clock_in", t(9), { voided: true })]).toVoid).toEqual([]);
  });
});
