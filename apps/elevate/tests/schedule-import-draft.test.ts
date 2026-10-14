import { describe, expect, it } from "vitest";
import { parseTimesheet, planRows } from "../scripts/schedule-import-core";
import { buildDraft, filterSheet, finalizeMapping, nameTokens, parseScheduleText, suggestedBreak, type ProductionExport } from "../scripts/schedule-import-draft-core";

// Invented people only. The shape mirrors HR's real sheet: a weekday word in the header row (once misspelled), a trailing space after a
// name, a quoted client with a comma, negative and impossible totals, rows with no clock-in, a "Training" row and a T-F pattern.
const sheet = [
  "10/01/26,,,,,,,,",
  "Thursday,Name,Client,Schedule,In,Lunch,Back,Out,Total Hours",
  ',Maria Santos Reyes,"Acme Health, LLC",8:00 am - 5:00 pm AZ,7:51 AM,12:00 PM,1:00 PM,5:02 PM,8.27',
  ',Jose Ramon D. Cruz,Acme Health LLC,9:00 am - 6:00 pm ET,8:55 AM,,,6:00 PM,-5.15',
  ',Ana Lopez,Beta Care,8:00 am - 12:00 pm AZ,7:56 AM,,,12:01 PM,4.08',
  ',Pedro Penduko,Beta Care,9:00 am - 4:30 pm AZ T-F,8:52 AM,,,4:32 PM,7.47',
  ',Luz Dela Cruz,Gamma,Training,7:59 AM,,,2:02 PM,6.05',
  ',Juan Tamad ,Gamma,10:00 am - 7:00 pm CT,,,,,0.00',
  ',Rita Twin,Gamma,8:00 am - 5:00 pm AZ,7:50 AM,,,5:00 PM,20.60',
  ',Rita Twin,Delta,8:00 am - 5:00 pm AZ,7:50 AM,,,5:00 PM,8.00',
  "10/02/26,,,,,,,,",
  "Wenesday,Name,Client,Schedule,In,Lunch,Back,Out,Total Hours",
  ',Maria Santos Reyes,"Acme Health, LLC",8:00 am - 5:00 pm AZ,7:53 AM,,,5:02 PM,8.27',
  ',Jose Ramon D. Cruz,Acme Health LLC,9:00 am - 6:00 pm ET,8:55 AM,,,6:00 PM,8.00',
  ',Ana Lopez,Beta Care,8:30 am - 12:30 pm AZ,7:56 AM,,,12:01 PM,4.08',
].join("\r\n");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const data: ProductionExport = {
  employees: [
    { id: id(1), workEmail: "maria@example.com", first: "Maria", middle: "Santos", last: "Reyes", preferred: null, status: "active" },
    { id: id(2), workEmail: "jose@example.com", first: "Jose Ramon", middle: "Dizon", last: "Cruz", preferred: null, status: "active" },
    { id: id(3), workEmail: "ana@example.com", first: "Ana", middle: null, last: "Lopez", preferred: null, status: "active" },
    { id: id(4), workEmail: "pedro@example.com", first: "Pedro", middle: null, last: "Penduko", preferred: null, status: "active" },
    { id: id(5), workEmail: "rita1@example.com", first: "Rita", middle: null, last: "Twin", preferred: null, status: "active" },
    { id: id(6), workEmail: "rita2@example.com", first: "Rita", middle: null, last: "Twin", preferred: null, status: "active" },
  ],
  clients: [
    { id: id(101), name: "Acme Health, LLC" },
    { id: id(102), name: "Beta Care" },
  ],
  assignments: [],
  schedules: [],
};

describe("reading HR's sheet", () => {
  it("accepts the weekday word in the header row, a misspelled one, and ignores the unreliable totals", () => {
    const obs = parseTimesheet(sheet);
    // clocked-in rows only, "Training" excluded, the blank-clock-in row ignored
    expect(obs.filter((o) => o.date === "2026-10-01")).toHaveLength(6);
    expect(obs.some((o) => o.name === "Juan Tamad")).toBe(false);
    expect(obs.some((o) => o.name === "Luz Dela Cruz")).toBe(false);
    expect(obs.every((o) => o.name === o.name.trim())).toBe(true);
  });
});

describe("matching names", () => {
  it("compares names without accents, punctuation, initials or word order", () => {
    expect(nameTokens("Jonalyn Princess Lituaña")).toEqual(["jonalyn", "princess", "lituana"]);
    expect(nameTokens("Glessah Mae M. Rafols")).toEqual(["glessah", "mae", "rafols"]);
    expect(nameTokens("Robert Anthony R Sebastian")).toEqual(["robert", "anthony", "sebastian"]);
  });

  it("reads shifts and refuses a weekday pattern or a non-shift", () => {
    expect(parseScheduleText("8:00 am - 5:00 pm AZ")).toEqual({ startTime: "08:00", endTime: "17:00", zone: "America/Phoenix" });
    expect(parseScheduleText("1:00 pm to 5:00 pm AZ")).toMatchObject({ startTime: "13:00", endTime: "17:00" });
    expect(parseScheduleText("12:00 pm - 8:30 pm ET")).toMatchObject({ startTime: "12:00", zone: "America/New_York" });
    expect(parseScheduleText("9:00 am - 4:30 pm AZ T-F")).toHaveProperty("error");
    expect(parseScheduleText("Training")).toHaveProperty("error");
  });

  it("suggests a break from the shift length", () => {
    expect(suggestedBreak("08:00", "17:00")).toBe(60);
    expect(suggestedBreak("08:00", "15:00")).toBe(30);
    expect(suggestedBreak("08:00", "12:00")).toBe(0);
    expect(suggestedBreak("22:00", "08:00")).toBe(60);
  });
});

describe("drafting the mapping", () => {
  const observations = parseTimesheet(sheet);
  const draft = buildDraft(observations, data);

  it("includes only what it can match with certainty and says why for the rest", () => {
    const names = draft.review.map((r) => r.name).sort();
    expect(names).toEqual(["Jose Ramon D. Cruz", "Maria Santos Reyes"]);
    const reasons = Object.fromEntries(draft.manual.map((m) => [`${m.name}|${m.client}`, m.reason]));
    expect(reasons["Ana Lopez|Beta Care"]).toMatch(/changed during the month/);
    expect(reasons["Pedro Penduko|Beta Care"]).toMatch(/weekday pattern/);
    expect(reasons["Rita Twin|Gamma"]).toMatch(/more than one client/i);
  });

  it("matches a middle initial and a quoted client name, and starts on the first day seen", () => {
    const jose = draft.mapping!.entries.find((e) => e.employeeId === id(2))!;
    expect(jose.assignmentStartDate).toBe("2026-10-01");
    expect(jose.shift).toMatchObject({ startTime: "09:00", endTime: "18:00", zone: "America/New_York", weekdays: [1, 2, 3, 4, 5], breakMinutes: 60 });
    expect(jose.clientName).toBe("Acme Health, LLC");
    expect(jose.hoursPerWeek).toBeNull();
  });

  it("is not usable until HR's acknowledgments are switched on, and then passes the importer's own checks", () => {
    expect(() => finalizeMapping(null)).toThrow();
    const final = finalizeMapping(JSON.parse(JSON.stringify(draft.mapping)));
    expect(final.decisions.every((d) => d.acknowledgeAttendanceReview && d.acknowledgeApprovalAndExportReview)).toBe(true);
    // the filtered sheet plus the mapping is exactly what planRows will accept
    const filtered = parseTimesheet(filterSheet(sheet, draft.includedPairs));
    expect(planRows(filtered, final)).toHaveLength(2);
  });

  it("leaves people who already have a different schedule or another client to individual review", () => {
    const withState: ProductionExport = {
      ...data,
      assignments: [{ id: id(201), employeeId: id(1), clientId: id(102), startDate: "2026-09-01", endDate: null, hoursPerWeek: null }],
      schedules: [{ id: id(301), employeeId: id(2), effectiveFrom: "2026-09-01", effectiveTo: null, startTime: "10:00", endTime: "19:00", zone: "America/New_York", weekdays: [1, 2, 3, 4, 5], breakMinutes: 60 }],
    };
    const d = buildDraft(observations, withState);
    expect(d.review).toHaveLength(0);
    expect(d.manual.filter((m) => /different client|different schedule/.test(m.reason))).toHaveLength(2);
  });

  it("keeps an exact existing open assignment as the reviewed before-state", () => {
    const withState: ProductionExport = {
      ...data,
      assignments: [{ id: id(201), employeeId: id(1), clientId: id(101), startDate: "2026-10-01", endDate: null, hoursPerWeek: null }],
    };
    const d = buildDraft(observations, withState);
    const maria = d.mapping!.decisions.find((x) => x.employeeId === id(1))!;
    expect(maria.expectedAssignment).toMatchObject({ id: id(201), clientId: id(101), startDate: "2026-10-01" });
    expect(maria.expectedSchedule).toBeNull();
  });
});
