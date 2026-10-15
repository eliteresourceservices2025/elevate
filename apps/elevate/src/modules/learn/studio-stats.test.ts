import { describe, expect, it } from "vitest";
import { LEARN_MIN_GROUP, moduleStats, questionStats } from "./studio-stats";

const q = (id: string, people: number, shown: number, missed: number) => ({ id, moduleKey: "m", topic: "t", stem: `Q ${id}`, people, shown, missed });

describe("course statistics", () => {
  it("hides questions answered by fewer than five people and lists the rest most missed first", () => {
    expect(LEARN_MIN_GROUP).toBe(5);
    const out = questionStats([q("a", 6, 6, 1), q("b", 10, 12, 9), q("c", 4, 4, 4), q("d", 0, 0, 0)]);
    expect(out.map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(out[0]).toMatchObject({ missPercent: 75, shown: 12 });
    expect(out[2]).toMatchObject({ hidden: true });
    expect("missPercent" in out[2]).toBe(false);
  });

  it("shows module time and miss rate only for groups of five or more, each on its own", () => {
    const [full, thin, onlyTime] = moduleStats([
      { key: "a", title: "A", people: 8, avgMinutes: 12.34, answered: 40, missed: 10, peopleAnswered: 8 },
      { key: "b", title: "B", people: 3, avgMinutes: 9, answered: 9, missed: 3, peopleAnswered: 3 },
      { key: "c", title: "C", people: 6, avgMinutes: 7, answered: 6, missed: 1, peopleAnswered: 4 },
    ]);
    expect(full).toMatchObject({ people: 8, avgMinutes: 12.3, missPercent: 25, hidden: false });
    expect(thin).toMatchObject({ people: 0, avgMinutes: null, missPercent: null, hidden: true });
    expect(onlyTime).toMatchObject({ avgMinutes: 7, missPercent: null, hidden: false });
  });
});
