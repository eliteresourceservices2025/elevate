import { describe, expect, it } from "vitest";
import { findDoubledRates, type DoubledInput } from "./doubled";

const line = (lineKey: string, first: string, last: string | null, over: Partial<DoubledInput> = {}): DoubledInput => ({
  lineKey,
  employeeId: "e1",
  clientName: "TL Family Nurse Practice",
  first,
  last,
  createdAt: Date.parse(first),
  onRealRun: false,
  ...over,
});

describe("findDoubledRates", () => {
  it("finds the pair from the Oct and Nov runs: old ends 12 Nov, new starts 16 Oct, same person and client", () => {
    const [g] = findDoubledRates([line("old", "2026-01-01", "2026-11-12"), line("new", "2026-10-16", null)]);
    expect(g.keep).toBe("new");
    expect(g.remove).toEqual([{ lineKey: "old", how: "withdraw", endsOn: null }]);
  });

  it("ignores the alias and treats two client records with the same name as one client", () => {
    const groups = findDoubledRates([
      line("a", "2026-01-01", null, { clientName: "Alturas Lab" }),
      line("b", "2026-10-16", null, { clientName: "  alturas   LAB " }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep).toBe("b");
  });

  it("keeps the same person on a different client (a second job) and different people apart", () => {
    expect(findDoubledRates([line("a", "2026-01-01", null), line("b", "2026-01-01", null, { clientName: "Zora Group" })])).toEqual([]);
    expect(findDoubledRates([line("a", "2026-01-01", null), line("b", "2026-01-01", null, { employeeId: "e2" })])).toEqual([]);
  });

  it("does not call lines doubled when one ended before the other began", () => {
    expect(findDoubledRates([line("old", "2026-01-01", "2026-10-15"), line("new", "2026-10-16", null)])).toEqual([]);
  });

  it("puts a no-client leftover with the person's only client, but not when the person has two clients", () => {
    const one = findDoubledRates([line("left", "2026-01-01", null, { clientName: null }), line("new", "2026-10-16", null)]);
    expect(one).toHaveLength(1);
    expect(one[0].keep).toBe("new");
    expect(one[0].remove[0].lineKey).toBe("left");
    const two = findDoubledRates([
      line("left", "2026-01-01", null, { clientName: null }),
      line("a", "2026-01-01", null, { clientName: "Alturas Lab" }),
      line("b", "2026-01-01", null, { clientName: "Zora Group" }),
    ]);
    expect(two).toEqual([]);
  });

  it("keeps the line that starts last, the later written one on a tie, and handles three lines", () => {
    const [g] = findDoubledRates([line("a", "2026-01-01", null), line("b", "2026-05-01", null), line("c", "2026-09-01", null)]);
    expect(g.keep).toBe("c");
    expect(g.remove.map((r) => r.lineKey).sort()).toEqual(["a", "b"]);
    const [tie] = findDoubledRates([line("x", "2026-10-01", null, { createdAt: 1 }), line("y", "2026-10-01", null, { createdAt: 2 })]);
    expect(tie.keep).toBe("y");
  });

  it("stops (not removes) a line that was paid on a real run, the day before the kept line starts; a same-day twin needs a manual look", () => {
    const [g] = findDoubledRates([line("old", "2026-01-01", null, { onRealRun: true }), line("new", "2026-10-16", null)]);
    expect(g.remove).toEqual([{ lineKey: "old", how: "end", endsOn: "2026-10-15" }]);
    const [same] = findDoubledRates([line("old", "2026-10-16", null, { onRealRun: true }), line("new", "2026-10-16", null, { createdAt: Date.parse("2026-10-17") })]);
    expect(same.remove).toEqual([{ lineKey: "old", how: "manual", endsOn: null }]);
  });

  it("gives a person with two separate doubled sets on one client two groups with different ids", () => {
    const groups = findDoubledRates([
      line("a", "2025-01-01", "2025-03-31"),
      line("b", "2025-02-01", "2025-04-30"),
      line("c", "2026-01-01", "2026-03-31"),
      line("d", "2026-02-01", null),
    ]);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.groupId)).size).toBe(2);
  });
});
