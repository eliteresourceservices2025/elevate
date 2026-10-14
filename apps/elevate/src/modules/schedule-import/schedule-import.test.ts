import { describe, expect, it } from "vitest";
import { clientKey, closest, hoursPerWeek, nameTokens, parseScheduleText, parseWeekdays, personKey, similarity, suggestedBreak } from "./parse";
import { buildPlan, combineSegments, type LiveData } from "./plan";
import { detectLayout, guessTableColumns, readDayBlocks, readTable } from "./reader";

// Invented people and clients only.
const blocks = [
  ["10/01/26", "", "", "", "", "", "", "", ""],
  ["Thursday", "Name", "Client", "Schedule", "In", "Lunch", "Back", "Out", "Total Hours"],
  ["", "Maria Santos Reyes", "Acme Health, LLC", "8:00 am - 5:00 pm AZ", "7:51 AM", "", "", "5:02 PM", "8.27"],
  ["", "Jose Ramon D. Cruz", "Acme Health, LLC", "9:00 am - 6:00 pm ET", "8:55 AM", "", "", "6:00 PM", "-5.15"],
  ["", "Pedro Penduko", "Beta Care", "9:00 am - 4:30 pm AZ T-F", "8:52 AM", "", "", "4:32 PM", "7.47"],
  ["", "Luz Dela Cruz", "Gamma", "Training", "7:59 AM", "", "", "2:02 PM", "6.05"],
  ["", "Juan Tamad", "Gamma", "10:00 am - 7:00 pm CT", "", "", "", "", "0.00"],
  ["10/02/26", "", "", "", "", "", "", "", ""],
  ["Wenesday", "Name", "Client", "Schedule", "In", "Lunch", "Back", "Out", "Total Hours"],
  ["", "Maria Santos Reyes", "Acme Health, LLC", "8:30 am - 5:30 pm AZ", "8:20 AM", "", "", "5:30 PM", "8.00"],
];

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const live: LiveData = {
  employees: [
    { id: id(1), workEmail: "maria@example.com", first: "Maria", middle: "Santos", last: "Reyes", preferred: null, status: "active" },
    { id: id(2), workEmail: "jose@example.com", first: "Jose Ramon", middle: "Dizon", last: "Cruz", preferred: null, status: "active" },
    { id: id(4), workEmail: "pedro@example.com", first: "Pedro", middle: null, last: "Penduko", preferred: null, status: "active" },
    { id: id(7), workEmail: "olga@example.com", first: "Olga", middle: null, last: "Missing", preferred: null, status: "active" },
  ],
  clients: [
    { id: id(101), name: "Acme Health LLC" },
    { id: id(102), name: "Beta Care" },
  ],
  assignments: [{ id: id(201), employeeId: id(7), clientId: id(101), startDate: "2026-09-01", endDate: null, hoursPerWeek: null }],
  schedules: [],
};

describe("schedule text", () => {
  it("reads shifts, zones and day patterns", () => {
    expect(parseScheduleText("8:00 am - 5:00 pm AZ")).toEqual({ startTime: "08:00", endTime: "17:00", zone: "America/Phoenix", weekdays: [1, 2, 3, 4, 5], pattern: null });
    expect(parseScheduleText("9:30 am - 6:00 pm CT T-S")).toMatchObject({ weekdays: [2, 3, 4, 5, 6], pattern: "T-S" });
    expect(parseScheduleText("9:00 am - 4:30 pm AZ T - F")).toMatchObject({ weekdays: [2, 3, 4, 5] });
    expect(parseScheduleText("1:00 pm to 5:00 pm AZ")).toMatchObject({ startTime: "13:00", endTime: "17:00" });
    expect(parseScheduleText("Training")).toHaveProperty("error");
    expect(parseScheduleText("9:00 am - 5:00 pm XX")).toHaveProperty("error");
  });
  it("reads day lists and ranges", () => {
    expect(parseWeekdays("Mon-Fri")).toEqual([1, 2, 3, 4, 5]);
    expect(parseWeekdays("M,W,F")).toEqual([1, 3, 5]);
    expect(parseWeekdays("nonsense")).toBeNull();
  });
  it("estimates hours per week from the shift", () => {
    expect(hoursPerWeek("08:00", "17:00", 60, 5)).toBe(40);
    expect(hoursPerWeek("09:30", "18:00", 60, 5)).toBe(37.5);
    expect(hoursPerWeek("22:00", "08:00", 60, 5)).toBe(45);
    expect(suggestedBreak("08:00", "12:00")).toBe(0);
  });
  it("matches names without accents or initials", () => {
    expect(nameTokens("Jonalyn Princess Lituaña")).toEqual(["jonalyn", "princess", "lituana"]);
  });
});

describe("reading a sheet", () => {
  it("detects day blocks and reads clocked-in days, ignoring the unreliable totals and Training", () => {
    expect(detectLayout(blocks)).toBe("day_blocks");
    const r = readDayBlocks(blocks);
    expect(r.observations.map((o) => [o.date, o.name])).toEqual([
      ["2026-10-01", "Maria Santos Reyes"], ["2026-10-01", "Jose Ramon D. Cruz"], ["2026-10-01", "Pedro Penduko"], ["2026-10-02", "Maria Santos Reyes"],
    ]);
    expect(r.skipped).toEqual({ training: 1, noClockIn: 1 });
  });

  it("reads a plain table through chosen columns", () => {
    const table = [
      ["Employee", "Account", "Shift", "Day"],
      ["Maria Santos Reyes", "Acme Health, LLC", "8:00 am - 5:00 pm AZ", "2026-10-05"],
      ["Pedro Penduko", "Beta Care", "8:00 am - 12:00 pm AZ", "10/06/2026"],
      ["", "", "", ""],
    ];
    expect(detectLayout(table)).toBe("table");
    const guess = guessTableColumns(table[0]);
    expect(guess).toMatchObject({ name: 0, client: 1, schedule: 2, date: 3 });
    const r = readTable(table, { name: 0, client: 1, schedule: 2, date: 3, clockIn: null });
    expect(r.observations).toHaveLength(2);
    expect(r.observations[1].date).toBe("2026-10-06");
  });
});

describe("planning", () => {
  const plan = buildPlan(readDayBlocks(blocks).observations, live, { today: "2026-10-14" });

  it("proposes the latest schedule, flags the change and the day pattern, and estimates hours", () => {
    const maria = plan.rows.find((r) => r.personId === id(1))!;
    expect(maria).toMatchObject({ startTime: "08:30", endTime: "17:30", firstDay: "2026-10-01", lastDay: "2026-10-02", assignment: "add", schedule: "add", status: "update", breakMinutes: 60, hoursPerWeek: 40 });
    expect(maria.attention.join(" ")).toMatch(/schedule changed/i);
    const pedro = plan.rows.find((r) => r.personId === id(4))!;
    expect(pedro.weekdays).toEqual([2, 3, 4, 5]);
    expect(pedro.attention.join(" ")).toMatch(/Tue, Wed, Thu, Fri/);
  });

  it("matches the client spelling and a middle initial, and marks old start dates as backdated", () => {
    const jose = plan.rows.find((r) => r.personId === id(2))!;
    expect(jose.clientName).toBe("Acme Health LLC");
    expect(jose.backdated).toBe(true);
  });

  it("lists who is on a sheet client but not on the sheet, and never ends anyone", () => {
    expect(plan.notOnSheet.map((n) => n.personName)).toEqual(["Olga Missing"]);
  });

  it("recognizes a person who already matches", () => {
    const withState: LiveData = {
      ...live,
      assignments: [...live.assignments, { id: id(202), employeeId: id(4), clientId: id(102), startDate: "2026-10-01", endDate: null, hoursPerWeek: null }],
      schedules: [{ id: id(301), employeeId: id(4), effectiveFrom: "2026-10-01", effectiveTo: null, startTime: "09:00", endTime: "16:30", zone: "America/Phoenix", weekdays: [2, 3, 4, 5], breakMinutes: 30 }],
    };
    const p = buildPlan(readDayBlocks(blocks).observations, withState, { today: "2026-10-14" });
    const pedro = p.rows.find((r) => r.personId === id(4))!;
    expect(pedro).toMatchObject({ assignment: "keep", schedule: "same", hoursNote: "fill", status: "update" });
    expect(pedro.hoursPerWeek).toBe(28);
  });

  it("sends people it cannot match with certainty to a person with the reason", () => {
    const obs = [
      { date: "2026-10-01", name: "Nobody Known", client: "Beta Care", schedule: "8:00 am - 5:00 pm AZ", row: 1 },
      { date: "2026-10-01", name: "Maria Santos Reyes", client: "Unknown Clinic", schedule: "8:00 am - 5:00 pm AZ", row: 2 },
      { date: "2026-10-01", name: "Pedro Penduko", client: "Beta Care", schedule: "Training", row: 3 },
    ];
    const p = buildPlan(obs, live, { today: "2026-10-14" });
    expect(p.rows).toHaveLength(0);
    expect(p.decisions.map((d) => d.reasons[0])).toEqual(
      expect.arrayContaining([expect.stringMatching(/No active person/), expect.stringMatching(/client is not in ELEVATE/), expect.stringMatching(/not a shift/)]),
    );
  });
});

describe("remembered matches", () => {
  const obs = [
    { date: "2026-10-05", name: "Jo Anne Reyes-Cruz", client: "Acme H.C.", schedule: "8:00 am - 5:00 pm AZ", row: 1 },
    { date: "2026-10-05", name: "Zed Unknown", client: "Beta Care", schedule: "8:00 am - 5:00 pm AZ", row: 2 },
  ];
  it("lists unmatched people and clients as resolvable decisions, other problems as not", () => {
    const p = buildPlan(obs, live, { today: "2026-10-14" });
    const byName = Object.fromEntries(p.decisions.map((d) => [d.sheetName, d.kind]));
    expect(byName["Zed Unknown"]).toBe("person");
    const unclear = buildPlan([{ date: "2026-10-05", name: "Maria Santos Reyes", client: "Acme H.C.", schedule: "8:00 am - 5:00 pm AZ", row: 1 }], live, { today: "2026-10-14" });
    expect(unclear.decisions[0].kind).toBe("client");
    const odd = buildPlan([{ date: "2026-10-05", name: "Maria Santos Reyes", client: "Beta Care", schedule: "whenever", row: 1 }], live, { today: "2026-10-14" });
    expect(odd.decisions[0].kind).toBe("other");
  });

  it("uses a remembered person and client match instead of guessing, and ignores a stale one", () => {
    const withAliases: LiveData = {
      ...live,
      aliases: { persons: { [personKey("Jo Anne Reyes-Cruz")]: id(1) }, clients: { [clientKey("Acme H.C.")]: id(101) } },
    };
    const p = buildPlan([obs[0]], withAliases, { today: "2026-10-14" });
    expect(p.decisions).toHaveLength(0);
    expect(p.rows[0]).toMatchObject({ personId: id(1), clientId: id(101) });
    const stale: LiveData = { ...live, aliases: { persons: { [personKey("Jo Anne Reyes-Cruz")]: id(999) }, clients: {} } };
    expect(buildPlan([obs[0]], stale, { today: "2026-10-14" }).decisions[0].kind).toBe("person");
  });

  it("keys a spelling the same way however it is written", () => {
    expect(personKey("Reyes, Maria Santos")).toBe(personKey("Maria  Santos Reyes"));
    expect(clientKey("Acme Health, LLC")).toBe(clientKey("ACME HEALTH LLC"));
  });
});

describe("closest match", () => {
  const clients = [
    { id: "a", label: "Inhouse Medical" },
    { id: "b", label: "Golden Years Primary Care" },
    { id: "c", label: "Alturos Labs" },
    { id: "d", label: "Zora Group" },
  ];
  it("suggests Inhouse Medical for In-House, and a clear spelling variant", () => {
    expect(closest("In-House", clients)?.id).toBe("a");
    expect(closest("Golden Years Primary Care, LLC", clients)?.id).toBe("b");
    expect(closest("Alturos Lab", clients)?.id).toBe("c");
  });
  it("suggests nothing when nothing is alike or two are about as close", () => {
    expect(closest("Davlei", clients)).toBeNull();
    expect(closest("Health", [{ id: "x", label: "Nourish Health" }, { id: "y", label: "Elite Health" }])).toBeNull();
  });
  it("scores identical names 1 and unrelated names low", () => {
    expect(similarity("Zora Group", "ZORA  group")).toBe(1);
    expect(similarity("Zora Group", "Alturos Labs")).toBeLessThan(0.3);
  });
  it("pre-selects the closest client on a decision and the closest person for a near spelling", () => {
    const l: LiveData = {
      ...live,
      employees: [...live.employees, { id: id(8), workEmail: "maribel@example.com", first: "Maribel", middle: null, last: "Reyes", preferred: null, status: "active" }],
      clients: [...live.clients, { id: id(103), name: "Inhouse Medical" }],
    };
    const p = buildPlan(
      [
        { date: "2026-10-05", name: "Maria Santos Reyes", client: "In-House", schedule: "8:00 am - 5:00 pm AZ", row: 1 },
        { date: "2026-10-05", name: "Maribell Reyes", client: "Beta Care", schedule: "8:00 am - 5:00 pm AZ", row: 2 },
      ],
      l,
      { today: "2026-10-14" },
    );
    const byName = Object.fromEntries(p.decisions.map((d) => [d.sheetName, d]));
    expect(byName["Maria Santos Reyes"].kind).toBe("client");
    expect(byName["Maria Santos Reyes"].suggestion).toEqual({ id: id(103), label: "Inhouse Medical" });
    expect(byName["Maribell Reyes"].suggestion?.id).toBe(id(8));
  });
});

describe("a person on more than one client", () => {
  const obs = (client: string, schedule: string, row: number, date = "2026-10-05") => ({ date, name: "Maria Santos Reyes", client, schedule, row });
  const plan = (o: ReturnType<typeof obs>[], l: LiveData = live) => buildPlan(o, l, { today: "2026-10-14" });

  it("combines back-to-back segments into one shift, with the gap as the break and the person's total on each client", () => {
    const p = plan([obs("Acme Health, LLC", "8:00 am - 12:00 pm AZ", 1), obs("Beta Care", "1:00 pm to 5:00 pm AZ", 2)]);
    expect(p.decisions).toEqual([]);
    expect(p.rows).toHaveLength(2);
    for (const r of p.rows) {
      expect(r).toMatchObject({ startTime: "08:00", endTime: "17:00", breakMinutes: 60, hoursPerWeek: 40, personId: id(1) });
      expect(r.siblingClientIds).toHaveLength(1);
    }
    expect(p.rows.map((r) => r.schedule).sort()).toEqual(["add", "shared"]);
    expect(p.rows.every((r) => r.assignment === "add")).toBe(true);
  });

  it("proposes the assignments but leaves the schedule alone when the segments overlap, are on different days or zones", () => {
    const overlap = plan([obs("Acme Health, LLC", "8:00 am - 1:00 pm AZ", 1), obs("Beta Care", "12:00 pm - 5:00 pm AZ", 2)]);
    expect(overlap.rows.map((r) => r.schedule)).toEqual(["unset", "unset"]);
    expect(overlap.rows[0].attention.join(" ")).toMatch(/overlap/);
    const days = plan([obs("Acme Health, LLC", "8:00 am - 12:00 pm AZ M-W", 1), obs("Beta Care", "8:00 am - 12:00 pm AZ T-F", 2)]);
    expect(days.rows.map((r) => r.schedule)).toEqual(["unset", "unset"]);
    expect(days.rows[0].hoursPerWeek).toBe(days.rows[1].hoursPerWeek);
    expect(days.rows.every((r) => r.assignment === "add")).toBe(true);
    const zones = plan([obs("Acme Health, LLC", "8:00 am - 12:00 pm AZ", 1), obs("Beta Care", "1:00 pm - 5:00 pm ET", 2)]);
    expect(zones.rows.map((r) => r.schedule)).toEqual(["unset", "unset"]);
  });

  it("does not set the schedule while one of the person's clients still needs a match", () => {
    const p = plan([obs("Acme Health, LLC", "8:00 am - 12:00 pm AZ", 1), obs("Inhouse Medicals", "1:00 pm - 5:00 pm AZ", 2)]);
    expect(p.decisions.map((d) => d.kind)).toEqual(["client"]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].schedule).toBe("unset");
    expect(p.rows[0].attention.join(" ")).toMatch(/still needs a match/);
  });

  it("keeps an existing assignment and adds the other client without ending it", () => {
    const l: LiveData = { ...live, assignments: [...live.assignments, { id: id(210), employeeId: id(1), clientId: id(101), startDate: "2026-09-01", endDate: null, hoursPerWeek: 20 }] };
    const p = plan([obs("Acme Health, LLC", "8:00 am - 12:00 pm AZ", 1), obs("Beta Care", "1:00 pm - 5:00 pm AZ", 2)], l);
    const byClient = Object.fromEntries(p.rows.map((r) => [r.clientName, r]));
    expect(byClient["Acme Health LLC"].assignment).toBe("keep");
    expect(byClient["Acme Health LLC"].hoursNote).toBe("differs");
    expect(byClient["Beta Care"].assignment).toBe("add");
  });

  it("combines segments only within a four-hour gap", () => {
    const seg = (startTime: string, endTime: string) => ({ parsed: { startTime, endTime, zone: "America/Phoenix", weekdays: [1, 2, 3, 4, 5], pattern: null }, breakMinutes: 0 });
    expect(combineSegments([seg("08:00", "12:00"), seg("13:00", "17:00")])).toMatchObject({ startTime: "08:00", endTime: "17:00", breakMinutes: 60 });
    expect(combineSegments([seg("06:00", "09:00"), seg("14:00", "17:00")])).toHaveProperty("error");
  });
});
