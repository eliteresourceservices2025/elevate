import { describe, expect, it } from "vitest";
import { buildHiring, buildStart, buildSummaries, chainOn, buildContext, isActiveOn, median, turnoverPercent, widenFrom, type PersonRec, type SourceData } from "./calc";
import { NIL_UUID } from "./constants";
import { addDays, addMonths, eachMonth, monthEnd, rangeStart, weekStart } from "./dates";
import { dashboardCsv } from "./export";
import { groupWithOther, isSmall } from "./suppress";
import { exportAnalyticsSchema, parseDashboardParams, parseScope } from "./validators";
import { attendancePoints, breakdown, headcountPoints, hiringView, leavePoints, movementPoints, type Dashboard } from "./view";

const TEAM = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const person = (id: string, over: Partial<PersonRec> = {}): PersonRec => ({ id, startDate: "2026-01-05", createdDate: "2026-01-01", endDate: null, archivedDate: null, teamId: null, managerId: null, ...over });
const empty: SourceData = { people: [], teamHistory: [], managerHistory: [], clientAssignments: [], leave: [], attendance: [] };

describe("dates", () => {
  it("does month and week arithmetic", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
    expect(weekStart("2026-10-01")).toBe("2026-09-28"); // a Thursday
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(eachMonth("2026-01-15", "2026-03-02")).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(rangeStart("2026-10-14", 3)).toBe("2026-08-01");
    expect(widenFrom("2026-03-01")).toBe("2026-02-23");
    expect(widenFrom("2026-03-04")).toBe("2026-03-01");
  });
});

describe("headcount and movement", () => {
  const data: SourceData = {
    ...empty,
    people: [
      person("a", { startDate: "2026-01-05" }),
      person("b", { startDate: "2026-01-20", endDate: "2026-02-10" }),
      person("c", { startDate: null, createdDate: "2026-02-03" }), // no start date: the record date counts
      person("d", { startDate: "2026-03-01", archivedDate: "2026-03-20" }), // archived with no end date: the archive date is the last day
    ],
  };
  it("counts people between their first and last day, both included", () => {
    const [a, b] = data.people;
    expect(isActiveOn(a, "2026-01-04")).toBe(false);
    expect(isActiveOn(a, "2026-01-05")).toBe(true);
    expect(isActiveOn(b, "2026-02-10")).toBe(true);
    expect(isActiveOn(b, "2026-02-11")).toBe(false);
  });
  it("builds daily headcount, joiners, leavers and average headcount", () => {
    const s = buildSummaries(data, "2026-01-01", "2026-03-31");
    const day = (d: string) => s.headcount.find((h) => h.date === d && h.dimKind === "company")?.headcount;
    expect(day("2026-01-04")).toBeUndefined();
    expect(day("2026-01-25")).toBe(2);
    expect(day("2026-02-10")).toBe(3);
    expect(day("2026-02-11")).toBe(2);
    expect(day("2026-03-25")).toBe(2);
    const feb = s.movement.find((m) => m.month === "2026-02-01" && m.dimKind === "company")!;
    expect(feb.joiners).toBe(1); // c
    expect(feb.leavers).toBe(1); // b
    expect(feb.endHeadcount).toBe(2);
    const mar = s.movement.find((m) => m.month === "2026-03-01" && m.dimKind === "company")!;
    expect(mar.joiners).toBe(1);
    expect(mar.leavers).toBe(1); // d
  });
  it("is idempotent: the same inputs give the same rows", () => {
    expect(buildSummaries(data, "2026-01-01", "2026-03-31")).toEqual(buildSummaries(data, "2026-01-01", "2026-03-31"));
  });
  it("gives the same numbers for a day whether built alone or inside a larger range", () => {
    const whole = buildSummaries(data, "2026-01-01", "2026-03-31");
    const part = buildSummaries(data, "2026-03-10", "2026-03-31");
    const pick = (s: typeof whole) => s.movement.find((m) => m.month === "2026-03-01" && m.dimKind === "company");
    expect(pick(part)).toEqual(pick(whole));
  });
  it("computes turnover as leavers over average headcount", () => {
    expect(turnoverPercent(2, 40)).toBe(5);
    expect(turnoverPercent(1, 0)).toBeNull();
  });
});

describe("dated team, client and downline", () => {
  const data: SourceData = {
    ...empty,
    people: [person("boss"), person("x", { teamId: "current-team-should-not-win", managerId: "boss" }), person("y", { teamId: TEAM, managerId: "boss" })],
    teamHistory: [
      { employeeId: "x", value: TEAM, from: "2026-01-05", to: "2026-02-14" },
      { employeeId: "x", value: null, from: "2026-02-15", to: null },
    ],
    managerHistory: [
      { employeeId: "x", value: "boss", from: "2026-01-05", to: "2026-02-14" },
      { employeeId: "x", value: null, from: "2026-02-15", to: null },
    ],
    clientAssignments: [{ employeeId: "x", value: CLIENT, from: "2026-01-10", to: "2026-01-31" }],
  };
  it("uses the dated history where there is some and the current value where there is none", () => {
    const s = buildSummaries(data, "2026-01-01", "2026-03-31");
    const at = (d: string, kind: string, id: string) => s.headcount.find((h) => h.date === d && h.dimKind === kind && h.dimId === id)?.headcount ?? 0;
    expect(at("2026-02-01", "team", TEAM)).toBe(2); // x (history) and y (current value)
    expect(at("2026-03-01", "team", TEAM)).toBe(1); // x left the team on Feb 15
    expect(at("2026-01-20", "client", CLIENT)).toBe(1);
    expect(at("2026-02-05", "client", CLIENT)).toBe(0);
    expect(at("2026-02-01", "downline", "boss")).toBe(2);
    expect(at("2026-03-01", "downline", "boss")).toBe(1);
  });
  it("cuts a loop in the chain", () => {
    const ctx = buildContext({ ...empty, people: [person("p", { managerId: "q" }), person("q", { managerId: "p" })] });
    expect(chainOn(ctx, "p", "2026-02-01")).toEqual(["q", "p"].slice(0, 1));
  });
});

describe("leave and attendance", () => {
  const data: SourceData = {
    ...empty,
    people: [person("a"), person("b")],
    leave: [
      { employeeId: "a", date: "2026-02-10", days: -1 },
      { employeeId: "b", date: "2026-02-12", days: -0.5 },
      { employeeId: "a", date: "2026-02-10", days: 1 }, // a reversal
    ],
    attendance: [
      { employeeId: "a", date: "2026-02-09", flags: ["late"] },
      { employeeId: "b", date: "2026-02-09", flags: ["absent"] },
      { employeeId: "a", date: "2026-02-10", flags: ["rest_day_work", "extra_hours", "unapproved_extra"] },
      { employeeId: "b", date: "2026-02-10", flags: [] },
    ],
  };
  const s = buildSummaries(data, "2026-02-01", "2026-02-28");
  it("nets reversals against usage per month", () => {
    expect(s.leave.find((l) => l.dimKind === "company")?.daysUsed).toBe(0.5);
  });
  it("counts flags per week, one extra-hours count per person-day, with no names", () => {
    const w = s.attendance.find((a) => a.weekStart === "2026-02-09" && a.dimKind === "company")!;
    expect(w).toMatchObject({ dayCount: 4, late: 1, absent: 1, extraHours: 1, unapprovedExtra: 1, groupSize: 2 });
    expect(JSON.stringify(s)).not.toMatch(/"a"|"b"|employeeId/);
  });
});

describe("hiring", () => {
  const at = (d: string) => new Date(`${d}T12:00:00Z`);
  const apps = [
    { id: "1", openingId: "J1", stage: "hired", appliedAt: at("2026-02-01"), closedAt: at("2026-02-21") },
    { id: "2", openingId: "J1", stage: "interview", appliedAt: at("2026-02-05"), closedAt: null },
    { id: "3", openingId: "J2", stage: "rejected", appliedAt: at("2026-03-02"), closedAt: at("2026-03-05") },
  ];
  const moves = [
    { applicationId: "1", toStage: "screening", at: at("2026-02-03") },
    { applicationId: "1", toStage: "interview", at: at("2026-02-10") },
    { applicationId: "1", toStage: "offer", at: at("2026-02-18") },
    { applicationId: "1", toStage: "hired", at: at("2026-02-21") },
    { applicationId: "2", toStage: "screening", at: at("2026-02-06") },
    { applicationId: "2", toStage: "interview", at: at("2026-02-12") },
    { applicationId: "3", toStage: "rejected", at: at("2026-03-05") },
  ];
  const monthOf = (d: Date) => `${d.toISOString().slice(0, 7)}-01`;
  const h = buildHiring(apps, moves, monthOf, "2026-01-01");
  const funnel = (month: string, opening: string, stage: string) => h.funnel.find((f) => f.month === month && f.openingId === opening && f.stage === stage)?.applications ?? 0;
  it("counts applications that reached each stage in the month they applied", () => {
    expect(funnel("2026-02-01", NIL_UUID, "applied")).toBe(2);
    expect(funnel("2026-02-01", NIL_UUID, "interview")).toBe(2);
    expect(funnel("2026-02-01", "J1", "offer")).toBe(1);
    expect(funnel("2026-02-01", NIL_UUID, "hired")).toBe(1);
    expect(funnel("2026-03-01", "J2", "rejected")).toBe(1);
  });
  it("measures time to hire from applied to hired, in the month of the hire", () => {
    const t = h.timeToHire.find((x) => x.month === "2026-02-01" && x.openingId === NIL_UUID)!;
    expect(t.hires).toBe(1);
    expect(t.totalDays).toBe(20);
    expect(t.medianDays).toBe(20);
  });
  it("falls back to the close time for a hire with no history row", () => {
    const r = buildHiring([apps[0]], [], monthOf, "2026-01-01");
    expect(r.timeToHire[0].totalDays).toBe(20);
  });
  it("has a median that handles even and empty lists", () => {
    expect(median([3, 1, 2, 10])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("the nightly start date", () => {
  const today = "2026-10-01";
  it("backfills the whole window the first time", () => {
    expect(buildStart(new Set(), today, 366, 7)).toBe(addDays(today, -366));
  });
  it("rebuilds only the recent days when nothing is missing", () => {
    const have = new Set<string>();
    for (let d = addDays(today, -40); d <= "2026-09-30"; d = addDays(d, 1)) have.add(d);
    expect(buildStart(have, today, 366, 7)).toBe("2026-09-24");
  });
  it("heals a missed night inside the window", () => {
    const have = new Set<string>();
    for (let d = addDays(today, -40); d <= "2026-09-30"; d = addDays(d, 1)) have.add(d);
    have.delete("2026-09-10");
    expect(buildStart(have, today, 366, 7)).toBe("2026-09-10");
  });
});

describe("small-group suppression", () => {
  it("treats fewer than 5 as small", () => {
    expect(isSmall(4)).toBe(true);
    expect(isSmall(5)).toBe(false);
    expect(isSmall(null)).toBe(true);
  });
  it("merges small groups into Other and keeps Other itself above the line", () => {
    const r = groupWithOther([{ n: "A", size: 20 }, { n: "B", size: 9 }, { n: "C", size: 3 }, { n: "D", size: 2 }]);
    expect(r.visible.map((g) => g.n)).toEqual(["A", "B"]);
    expect(r.other).toMatchObject({ size: 5, members: 2 });
  });
  it("pulls in the smallest visible group when Other alone would be small (no derivation by subtraction)", () => {
    const r = groupWithOther([{ n: "A", size: 20 }, { n: "B", size: 6 }, { n: "C", size: 3 }]);
    expect(r.visible.map((g) => g.n)).toEqual(["A"]);
    expect(r.other).toMatchObject({ size: 9, members: 2 });
  });
  it("shows nothing when the whole breakdown is too small", () => {
    expect(groupWithOther([{ n: "A", size: 2 }, { n: "B", size: 1 }])).toEqual({ visible: [], other: null });
  });
  it("breakdown never lists a small group by name", () => {
    const b = breakdown([{ id: "1", name: "Big", headcount: 30 }, { id: "2", name: "Secret small team", headcount: 3 }, { id: "3", name: "Other small", headcount: 4 }]);
    expect(JSON.stringify(b)).not.toContain("Secret");
    expect(b.other).toEqual({ headcount: 7, groups: 2 });
  });
});

describe("views hide cells of small groups", () => {
  it("hides headcount points below 5", () => {
    expect(headcountPoints([{ date: "2026-01-31", headcount: 4 }, { date: "2026-02-28", headcount: 5 }], "2026-01-01", "2026-02-28").map((p) => p.headcount)).toEqual([null, 5]);
  });
  it("hides movement and turnover for a month whose group was small, using the smaller of average and end", () => {
    const pts = movementPoints(
      [
        { month: "2026-01-01", joiners: 1, leavers: 1, avgHeadcount: 10, endHeadcount: 4 },
        { month: "2026-02-01", joiners: 0, leavers: 2, avgHeadcount: 20, endHeadcount: 20 },
      ],
      "2026-01-01",
      "2026-03-01",
    );
    expect(pts[0]).toMatchObject({ joiners: null, leavers: null, turnover: null });
    expect(pts[1]).toMatchObject({ leavers: 2, turnover: 10 });
    expect(pts[2].leavers).toBeNull(); // no row: no known group
  });
  it("hides leave and attendance cells by group size", () => {
    expect(leavePoints([{ month: "2026-01-01", daysUsed: 3, groupSize: 4 }], "2026-01-01", "2026-01-31")[0].daysUsed).toBeNull();
    const a = attendancePoints([{ weekStart: "2026-01-05", dayCount: 3, late: 1, absent: 0, leftEarly: 0, extraHours: 0, unapprovedExtra: 0, groupSize: 3 }], "2026-01-01", "2026-01-31");
    expect(a[0].late).toBeNull();
    expect(a[0].lateRate).toBeNull();
  });
  it("hides the funnel when fewer than 5 applied, and small jobs go to Other", () => {
    const rows = (applied: number, stage = "applied", opening = NIL_UUID) => ({ month: "2026-01-01", openingId: opening, stage, applications: applied });
    const few = hiringView([rows(4)], [], new Map(), "2026-01-01", "2026-01-31");
    expect(few.funnel[0].applications).toBeNull();
    const many = hiringView([rows(30), rows(20, "applied", "J1"), rows(7, "applied", "J2"), rows(3, "applied", "J3")], [], new Map([["J1", "Big job"], ["J2", "Mid job"], ["J3", "Tiny job"]]), "2026-01-01", "2026-01-31");
    expect(many.funnel[0].applications).toBe(30);
    expect(JSON.stringify(many)).not.toContain("Tiny job");
    expect(many.otherJobs?.applied).toBe(10);
  });
  it("hides time to hire for fewer than 5 hires", () => {
    const v = hiringView([], [{ month: "2026-01-01", openingId: NIL_UUID, hires: 2, totalDays: 40, medianDays: 20 }], new Map(), "2026-01-01", "2026-01-31");
    expect(v.timeToHire[0]).toMatchObject({ hires: 2, avgDays: null, medianDays: null });
    expect(v.overall.avgDays).toBeNull();
  });
});

describe("inputs", () => {
  it("parses the group and falls back safely", () => {
    expect(parseScope("company")).toEqual({ kind: "company", id: null });
    expect(parseScope(`team:${TEAM}`)).toEqual({ kind: "team", id: TEAM });
    expect(parseScope("team:not-a-uuid")).toBeNull();
    expect(parseScope("downline")).toBeNull();
    expect(parseScope(`team:${TEAM}' or 1=1`)).toBeNull();
    expect(parseDashboardParams({ range: "99", scope: "x" })).toEqual({ range: 12, scope: { kind: "company", id: null } });
    expect(parseDashboardParams({ range: ["6"], scope: `client:${CLIENT}` })).toEqual({ range: 6, scope: { kind: "client", id: CLIENT } });
    expect(parseDashboardParams(undefined).range).toBe(12);
  });
  it("refuses a bad export request", () => {
    expect(exportAnalyticsSchema.safeParse({ range: 6, scope: "company" }).success).toBe(true);
    expect(exportAnalyticsSchema.safeParse({ range: 7, scope: "company" }).success).toBe(false);
    expect(exportAnalyticsSchema.safeParse({ range: 6, scope: "everyone" }).success).toBe(false);
  });
});

describe("csv export", () => {
  const dash: Dashboard = {
    asOf: "2026-09-30",
    rangeMonths: 3,
    scope: { value: "company", label: "Whole company" },
    scopeOptions: [],
    peopleNote: null,
    teams: { rows: [{ id: "t", name: "=HYPERLINK(\"x\")", headcount: 12 }], other: null, hiddenAll: false },
    clients: null,
    people: { hidden: false, headcountNow: 40, headcount: [{ date: "2026-09-30", headcount: 40 }], movement: [{ month: "2026-09-01", joiners: null, leavers: null, avgHeadcount: null, turnover: null }], leave: [], attendance: [] },
    hiring: null,
  };
  it("writes hidden cells as text, never a number, and protects formula-looking names", () => {
    const { csv } = dashboardCsv(dash);
    expect(csv).toContain("Joiners,fewer than 5");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.split("\r\n")[0]).toBe("Section,Period,Group,Metric,Value");
  });
});
