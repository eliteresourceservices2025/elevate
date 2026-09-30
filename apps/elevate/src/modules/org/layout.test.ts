import { describe, expect, it } from "vitest";
import { VIRTUAL_ROOT, ancestorsOf, indexPeople, layoutOrgChart, managersOf, NODE_WIDTH } from "./layout";

const p = (id: string, managerId: string | null) => ({ id, managerId, name: id });

// ceo -> (a, b); a -> (a1, a2); b -> (b1)
const COMPANY = [p("ceo", null), p("a", "ceo"), p("b", "ceo"), p("a1", "a"), p("a2", "a"), p("b1", "b")];

describe("layoutOrgChart", () => {
  it("lays out one tree with no virtual root when there is a single top person", () => {
    const l = layoutOrgChart(COMPANY);
    expect(l.nodes.map((n) => n.id).sort()).toEqual(["a", "a1", "a2", "b", "b1", "ceo"]);
    expect(l.nodes.some((n) => n.virtual)).toBe(false);
    expect(l.edges).toHaveLength(5);
    const depth = Object.fromEntries(l.nodes.map((n) => [n.id, n.depth]));
    expect(depth).toMatchObject({ ceo: 0, a: 1, b: 1, a1: 2, a2: 2, b1: 2 });
  });

  it("puts siblings side by side and levels below their parents", () => {
    const l = layoutOrgChart(COMPANY);
    const at = (id: string) => l.nodes.find((n) => n.id === id)!;
    expect(at("a").y).toBe(at("b").y);
    expect(Math.abs(at("a").x - at("b").x)).toBeGreaterThanOrEqual(NODE_WIDTH);
    expect(at("a1").y).toBeGreaterThan(at("a").y);
  });

  it("adds a virtual root above several top-level people", () => {
    const l = layoutOrgChart([p("x", null), p("y", null), p("x1", "x")]);
    expect(l.nodes.find((n) => n.virtual)?.id).toBe(VIRTUAL_ROOT);
    expect(l.edges.map((e) => e.source)).toContain(VIRTUAL_ROOT);
  });

  it("counts everyone below each person, at every level", () => {
    const l = layoutOrgChart(COMPANY);
    expect(l.descendants.get("ceo")).toBe(5);
    expect(l.descendants.get("a")).toBe(2);
    expect(l.descendants.get("b1")).toBe(0);
  });

  it("hides everything below a collapsed person but still counts them", () => {
    const l = layoutOrgChart(COMPANY, new Set(["a"]));
    expect(l.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "b1", "ceo"]);
    expect(l.descendants.get("a")).toBe(2);
  });

  it("treats a manager who is not in the list as no manager", () => {
    const i = indexPeople([p("lone", "gone")]);
    expect(i.roots).toEqual(["lone"]);
  });

  it("survives a corrupt loop and a self-manager without hanging or duplicating", () => {
    const l = layoutOrgChart([p("a", "b"), p("b", "a"), p("c", "c")]);
    const ids = l.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("handles nobody", () => {
    expect(layoutOrgChart([]).nodes).toEqual([]);
  });
});

describe("helpers", () => {
  it("managersOf lists people with reports", () => {
    expect(managersOf(COMPANY).sort()).toEqual(["a", "b", "ceo"]);
  });
  it("ancestorsOf walks up nearest first", () => {
    expect(ancestorsOf(COMPANY, "a1")).toEqual(["a", "ceo"]);
    expect(ancestorsOf(COMPANY, "ceo")).toEqual([]);
  });
});
