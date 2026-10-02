import { describe, expect, it } from "vitest";
import { DEFAULT_OFFBOARDING_ITEMS, DEFAULT_ONBOARDING_ITEMS, buildTasks, dueOn, progress, separationDue } from "./constants";
import { checklistTemplateSchema, startOffboardingSchema } from "./validators";

describe("dueOn", () => {
  it("counts calendar days from the anchor, before and after", () => {
    expect(dueOn("2026-03-01", 3)).toBe("2026-03-04");
    expect(dueOn("2026-03-01", -1)).toBe("2026-02-28");
    expect(dueOn("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("buildTasks", () => {
  const ctx = { anchor: "2026-05-10", leadUserId: "lead-1", personUserId: "person-1" };
  it("resolves owners and due dates, and keeps the order", () => {
    const rows = buildTasks(DEFAULT_ONBOARDING_ITEMS, ctx);
    expect(rows).toHaveLength(DEFAULT_ONBOARDING_ITEMS.length);
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.find((r) => r.owner === "person")?.ownerUserId).toBe("person-1");
    expect(rows.find((r) => r.owner === "lead")?.ownerUserId).toBe("lead-1");
    expect(rows.find((r) => r.owner === "hr")?.ownerUserId).toBeNull();
    expect(rows.find((r) => r.title.startsWith("Equipment"))?.dueOn).toBe("2026-05-09");
  });
  it("leaves a lead task unowned when nobody leads", () => {
    expect(buildTasks(DEFAULT_ONBOARDING_ITEMS, { ...ctx, leadUserId: null }).find((r) => r.owner === "lead")?.ownerUserId).toBeNull();
  });
  it("drops links that leave ELEVATE", () => {
    const rows = buildTasks([{ title: "x", owner: "hr", dueOffsetDays: 0, required: true, check: "manual", href: "//evil.example" }, { title: "y", owner: "hr", dueOffsetDays: 0, required: true, check: "manual", href: "/signing" }], ctx);
    expect(rows[0].href).toBeNull();
    expect(rows[1].href).toBe("/signing");
  });
  it("has an access-removal task in the default offboarding list", () => {
    expect(DEFAULT_OFFBOARDING_ITEMS.some((i) => i.check === "access")).toBe(true);
  });
});

describe("progress", () => {
  const t = (status: "todo" | "done" | "skipped", required: boolean, dueOn: string, satisfied = false) => ({ status, required, dueOn, satisfied });
  it("counts satisfied, skipped and done tasks as closed", () => {
    const p = progress([t("done", true, "2026-01-01"), t("skipped", true, "2026-01-01"), t("todo", true, "2026-01-01", true), t("todo", true, "2026-01-01")], "2026-02-01");
    expect(p).toMatchObject({ total: 4, done: 3, requiredOpen: 1, overdue: 1, ready: false });
  });
  it("is ready when only optional tasks remain, but not when there are no tasks", () => {
    expect(progress([t("done", true, "2026-01-01"), t("todo", false, "2026-01-01")], "2026-01-01").ready).toBe(true);
    expect(progress([], "2026-01-01").ready).toBe(false);
  });
  it("does not call a task due today late", () => {
    expect(progress([t("todo", true, "2026-02-01")], "2026-02-01").overdue).toBe(0);
  });
});

describe("separationDue", () => {
  it("waits until the last working day has ended in the person's own zone", () => {
    // Manila is UTC+8: 2026-05-10 ends at 2026-05-10T16:00Z
    expect(separationDue("2026-05-10", "Asia/Manila", new Date("2026-05-10T15:59:00Z"))).toBe(false);
    expect(separationDue("2026-05-10", "Asia/Manila", new Date("2026-05-10T16:00:00Z"))).toBe(true);
    // Phoenix is UTC-7 all year: the same day ends at 2026-05-11T07:00Z
    expect(separationDue("2026-05-10", "America/Phoenix", new Date("2026-05-11T06:59:00Z"))).toBe(false);
    expect(separationDue("2026-05-10", "America/Phoenix", new Date("2026-05-11T07:00:00Z"))).toBe(true);
  });
});

describe("validators", () => {
  const item = { title: "Do it", owner: "hr", dueOffsetDays: 0, required: true, check: "manual" };
  it("needs the right link target for each automatic check", () => {
    expect(checklistTemplateSchema.safeParse({ kind: "onboarding", name: "Tmpl", items: [{ ...item, check: "document" }] }).success).toBe(false);
    expect(checklistTemplateSchema.safeParse({ kind: "onboarding", name: "Tmpl", items: [{ ...item, check: "policy" }] }).success).toBe(false);
    expect(checklistTemplateSchema.safeParse({ kind: "onboarding", name: "Tmpl", items: [{ ...item, check: "policy", policyKind: "monitoring" }] }).success).toBe(true);
    expect(checklistTemplateSchema.safeParse({ kind: "onboarding", name: "Tmpl", items: [{ ...item, check: "signature" }] }).success).toBe(false);
  });
  it("only accepts links inside ELEVATE", () => {
    for (const href of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) expect(checklistTemplateSchema.safeParse({ kind: "onboarding", name: "Tmpl", items: [{ ...item, href }] }).success).toBe(false);
    expect(checklistTemplateSchema.safeParse({ kind: "onboarding", name: "Tmpl", items: [{ ...item, href: "/signing" }] }).success).toBe(true);
  });
  it("needs at least one task and a valid last working day", () => {
    expect(checklistTemplateSchema.safeParse({ kind: "offboarding", name: "Tmpl", items: [] }).success).toBe(false);
    expect(startOffboardingSchema.safeParse({ employeeId: "11111111-1111-4111-8111-111111111111", lastWorkingDay: "soon", reason: "resignation" }).success).toBe(false);
    expect(startOffboardingSchema.safeParse({ employeeId: "11111111-1111-4111-8111-111111111111", lastWorkingDay: "2026-05-10", reason: "fired" }).success).toBe(false);
  });
});
