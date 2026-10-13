import { describe, expect, it } from "vitest";
import {
  EXAM_MAX_TRIES,
  EXAM_PASS_PERCENT,
  EXAM_QUESTIONS_FULL,
  EXAM_QUESTIONS_SHORT,
  LAUNCH_TOKEN_SECONDS,
  MIN_TIME_SHARE,
  NEW_HIRE_DUE_DAYS,
  RENEWAL_MONTHS,
} from "./constants";

describe("decided training rules", () => {
  it("keeps the values agreed with the owner", () => {
    expect(EXAM_PASS_PERCENT).toBe(80);
    expect(EXAM_MAX_TRIES).toBe(3);
    expect(EXAM_QUESTIONS_FULL).toBe(15);
    expect(EXAM_QUESTIONS_SHORT).toBe(15);
    expect(NEW_HIRE_DUE_DAYS).toBe(30);
    expect(RENEWAL_MONTHS).toBe(12);
  });

  it("keeps the handoff token short-lived and the time share below the whole estimate", () => {
    expect(LAUNCH_TOKEN_SECONDS).toBeLessThanOrEqual(60);
    expect(MIN_TIME_SHARE).toBeGreaterThan(0);
    expect(MIN_TIME_SHARE).toBeLessThan(1);
  });
});
