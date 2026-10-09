import { describe, expect, it } from "vitest";
import type { CalendarView } from "@/modules/timeoff/request-queries";
import { daysSince, plural, rankAttention, waitingSeverity } from "./attention";
import { availableLenses, defaultLens, pickLens } from "./lens";
import { QUICK_ACTIONS, quickActionsFor } from "./quick-actions";
import { dayLabel, monthsTouched, weekAhead } from "./week-ahead";

const user = (...roles: Parameters<typeof availableLenses>[0][number][]) => ({ id: "u1", roles });

describe("views (lenses)", () => {
  it("everyone has My work, and it is the only view for a plain employee", () => {
    expect(availableLenses(["employee"])).toEqual(["my_work"]);
    expect(defaultLens(["employee"])).toBe("my_work");
  });
  it("dual roles get a view for each, most senior first, My work last", () => {
    expect(availableLenses(["employee", "hr_admin", "executive"])).toEqual(["hr", "executive", "my_work"]);
    expect(availableLenses(["employee", "team_lead", "recruiter"])).toEqual(["team_lead", "recruiter", "my_work"]);
    expect(availableLenses(["employee", "executive", "super_admin"])).toEqual(["admin", "hr", "executive", "team_lead", "recruiter", "my_work"]);
    expect(defaultLens(["employee", "team_lead", "recruiter"])).toBe("team_lead");
  });
  it("a Super Admin has the HR, My team and Hiring views as well as Admin", () => {
    expect(availableLenses(["employee", "super_admin"])).toEqual(["admin", "hr", "team_lead", "recruiter", "my_work"]);
    expect(defaultLens(["employee", "super_admin"])).toBe("admin");
    expect(pickLens(["employee", "super_admin"], "recruiter")).toBe("recruiter");
  });
  it("only offers a view the person holds, falling back to the default", () => {
    expect(pickLens(["employee", "hr_admin"], "executive", undefined)).toBe("hr");
    expect(pickLens(["employee", "hr_admin"], "nonsense", "my_work")).toBe("my_work");
    expect(pickLens(["employee"], "admin")).toBe("my_work");
  });
});

describe("quick actions", () => {
  it("shows HR their buttons and an employee only their own", () => {
    const hr = quickActionsFor(user("employee", "hr_admin"), "hr").map((q) => q.id);
    expect(hr).toContain("add-person");
    expect(hr).toContain("post-announcement");
    const emp = quickActionsFor(user("employee"), "my_work").map((q) => q.id);
    expect(emp).toEqual(expect.arrayContaining(["request-time-off", "extra-hours", "my-profile"]));
    expect(emp).not.toContain("add-person");
  });
  it("never offers a button the person has no permission for, whatever view is asked for", () => {
    for (const lens of ["admin", "hr", "executive", "team_lead", "recruiter", "my_work"] as const) {
      const ids = quickActionsFor(user("employee"), lens, 50).map((q) => q.id);
      for (const id of ["add-person", "award-days", "post-announcement", "send-for-signature", "start-offboarding", "launch-review", "register-asset"]) expect(ids).not.toContain(id);
    }
  });
  it("a team lead can review hours but not add people", () => {
    const ids = quickActionsFor(user("employee", "team_lead"), "team_lead").map((q) => q.id);
    expect(ids).toContain("review-hours");
    expect(ids).not.toContain("add-person");
  });
  it("every button links inside the app", () => {
    for (const q of QUICK_ACTIONS) expect(q.href.startsWith("/")).toBe(true);
  });
});

describe("needs attention", () => {
  const item = (id: string, severity: "urgent" | "warn" | "info", lenses: Parameters<typeof rankAttention>[1][] = ["hr"]) => ({ id, severity, title: id, href: "/x", lenses });
  it("puts urgent first, keeps the found order within a level, and only shows what belongs in the view", () => {
    const ranked = rankAttention([item("a", "info"), item("b", "urgent"), item("c", "warn"), item("d", "urgent"), item("e", "warn", ["my_work"])], "hr");
    expect(ranked.map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  });
  it("stops at the limit", () => {
    expect(rankAttention(Array.from({ length: 12 }, (_, i) => item(`i${i}`, "info")), "hr", 5)).toHaveLength(5);
  });
  it("counts whole days waited and grades a pile by its oldest request", () => {
    expect(daysSince("2026-10-01T00:00:00.000Z", new Date("2026-10-04T12:00:00.000Z"))).toBe(3);
    expect(waitingSeverity(0, 2)).toBe("info");
    expect(waitingSeverity(2, 2)).toBe("warn");
    expect(waitingSeverity(5, 1)).toBe("urgent");
    expect(waitingSeverity(0, 10)).toBe("urgent");
  });
  it("speaks in plain plurals", () => {
    expect(plural(1, "request", "requests")).toBe("1 request");
    expect(plural(1234, "person", "people")).toBe("1,234 people");
  });
});

describe("week ahead", () => {
  const view = (over: Partial<CalendarView> = {}): CalendarView => ({ month: "2026-10", mode: "all", dates: [], entries: [], counts: {}, holidays: [], ...over });
  const entry = (name: string, startDate: string, endDate: string, pending = false) => ({ employeeId: name, name, leaveType: null, startDate, endDate, days: 1, pending });

  it("labels today and tomorrow, then the weekday", () => {
    expect(dayLabel("2026-10-05", "2026-10-05")).toBe("Today");
    expect(dayLabel("2026-10-06", "2026-10-05")).toBe("Tomorrow");
    expect(dayLabel("2026-10-09", "2026-10-05")).toBe("Fri, Oct 9");
  });
  it("skips quiet weekends and leaves pending requests out", () => {
    const days = weekAhead([view({ entries: [entry("Ana Cruz", "2026-10-06", "2026-10-07"), entry("Ben Lim", "2026-10-06", "2026-10-06", true)] })], "2026-10-05", 7);
    expect(days.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(days.find((d) => d.date === "2026-10-06")?.names).toEqual(["Ana Cruz"]);
  });
  it("shows a holiday on a weekend and crosses the end of a month", () => {
    expect(monthsTouched("2026-10-29", 7)).toEqual(["2026-10", "2026-11"]);
    const days = weekAhead([view({ holidays: [{ date: "2026-10-10", name: "Founders Day", calendar: "PH" }] })], "2026-10-08", 7);
    expect(days.find((d) => d.date === "2026-10-10")?.holidays).toEqual(["Founders Day (PH)"]);
  });
  it("keeps only counts for a view that hides names, and folds long lists", () => {
    const counts = weekAhead([view({ mode: "counts", counts: { "2026-10-05": 3 } })], "2026-10-05", 1);
    expect(counts[0]).toMatchObject({ count: 3, names: [] });
    const many = weekAhead([view({ entries: ["A", "B", "C", "D", "E", "F"].map((n) => entry(`${n} Person`, "2026-10-05", "2026-10-05")) })], "2026-10-05", 1);
    expect(many[0].names).toHaveLength(4);
    expect(many[0].extra).toBe(2);
  });
});
