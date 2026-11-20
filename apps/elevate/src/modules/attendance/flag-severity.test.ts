import { describe, expect, it } from "vitest";
import { FLAG_LABELS } from "./flag-labels";
import { BLOCKING_FLAGS, CLEAN_FLAGS, HARD_STOP_FLAGS, flagSeverity, worstSeverity } from "./flag-severity";

describe("flag severity", () => {
  it("ranks flags as clean, review or blocked", () => {
    expect(flagSeverity("on_leave")).toBe("clean");
    expect(flagSeverity("late")).toBe("review");
    expect(flagSeverity("long_session")).toBe("blocked");
    expect(flagSeverity("unapproved_extra")).toBe("blocked");
  });

  it("takes the worst of several flags", () => {
    expect(worstSeverity([])).toBe("clean");
    expect(worstSeverity(["corrected", "extra_hours"])).toBe("clean");
    expect(worstSeverity(["corrected", "late"])).toBe("review");
    expect(worstSeverity(["late", "absent"])).toBe("blocked");
  });

  it("a hard stop is always a blocking flag, never a clean one", () => {
    for (const flag of HARD_STOP_FLAGS) {
      expect(BLOCKING_FLAGS.has(flag)).toBe(true);
      expect(CLEAN_FLAGS.has(flag)).toBe(false);
    }
  });

  it("every flag set names only flags that have a label", () => {
    for (const flag of [...CLEAN_FLAGS, ...BLOCKING_FLAGS, ...HARD_STOP_FLAGS]) expect(FLAG_LABELS.has(flag)).toBe(true);
  });
});
