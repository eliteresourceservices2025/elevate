import { describe, expect, it } from "vitest";
import { activitySettingsSchema, archiveCategorySchema, categorySchema, segmentsBodySchema } from "./validators";

describe("activitySettingsSchema", () => {
  const ok = { idleTimeoutSeconds: 180, offlineGraceMinutes: 5, lowActivityPercent: 30 };
  it("accepts the defaults and the limits", () => {
    expect(activitySettingsSchema.safeParse(ok).success).toBe(true);
    expect(activitySettingsSchema.safeParse({ idleTimeoutSeconds: 60, offlineGraceMinutes: 2, lowActivityPercent: 5 }).success).toBe(true);
    expect(activitySettingsSchema.safeParse({ idleTimeoutSeconds: 900, offlineGraceMinutes: 60, lowActivityPercent: 90 }).success).toBe(true);
  });
  it("rejects values outside the limits and fractions", () => {
    expect(activitySettingsSchema.safeParse({ ...ok, idleTimeoutSeconds: 59 }).success).toBe(false);
    expect(activitySettingsSchema.safeParse({ ...ok, idleTimeoutSeconds: 901 }).success).toBe(false);
    expect(activitySettingsSchema.safeParse({ ...ok, offlineGraceMinutes: 1 }).success).toBe(false);
    expect(activitySettingsSchema.safeParse({ ...ok, lowActivityPercent: 91 }).success).toBe(false);
    expect(activitySettingsSchema.safeParse({ ...ok, lowActivityPercent: 30.5 }).success).toBe(false);
  });
});

describe("archiveCategorySchema", () => {
  it("needs a uuid", () => {
    expect(archiveCategorySchema.safeParse({ id: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
    expect(archiveCategorySchema.safeParse({ id: "nope" }).success).toBe(false);
  });
});

describe("categorySchema and segmentsBodySchema", () => {
  it("rejects a pattern that is not a valid regular expression", () => {
    expect(categorySchema.safeParse({ pattern: "(", category: "work", rank: 10 }).success).toBe(false);
    expect(categorySchema.safeParse({ pattern: "^zoom$", category: "work", rank: 10 }).success).toBe(true);
  });
  it("drops a window title sent by mistake instead of keeping it", () => {
    const now = new Date().toISOString();
    const parsed = segmentsBodySchema.parse({ segments: [{ start: now, end: now, app: "Chrome", state: "active", title: "Patient John" }] });
    expect(JSON.stringify(parsed)).not.toContain("Patient");
  });
});
