/* eslint-disable security/detect-object-injection -- keys come from the fixed category, status and outcome lists */
import { describe, expect, it } from "vitest";
import * as app from "../../../../safe-voice/src/lib/constants";
import { CATEGORY_LABELS, MIN_CATEGORY_COUNT, OUTCOME_LABELS, SAFEVOICE_CATEGORIES, SAFEVOICE_OUTCOMES, SAFEVOICE_STATUSES, STATUS_LABELS, caseReference } from "./constants";
import { publishableStats } from "./stats";

describe("lists shared with the Safe Voice app", () => {
  it("are identical in both apps", () => {
    expect([...app.CATEGORIES]).toEqual([...SAFEVOICE_CATEGORIES]);
    expect([...app.STATUSES]).toEqual([...SAFEVOICE_STATUSES]);
    expect([...app.OUTCOMES]).toEqual([...SAFEVOICE_OUTCOMES]);
    for (const c of SAFEVOICE_CATEGORIES) expect(app.CATEGORY_LABELS[c]).toBe(CATEGORY_LABELS[c]);
  });

  it("have a label for everything", () => {
    for (const c of SAFEVOICE_CATEGORIES) expect(CATEGORY_LABELS[c]).toBeTruthy();
    for (const s of SAFEVOICE_STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
    for (const o of SAFEVOICE_OUTCOMES) expect(OUTCOME_LABELS[o]).toBeTruthy();
  });

  it("a case reference is a short form of the internal id, not a code", () => {
    expect(caseReference("0a1b2c3d-1111-4111-8111-111111111111")).toBe("SV-0A1B2C3D");
  });
});

describe("publishableStats: small categories are held back", () => {
  it("shows categories with at least 5 reports and hides the rest", () => {
    const s = publishableStats({ harassment: 12, safety: 5, retaliation: 4, other: 0 });
    expect(s.rows.map((r) => [r.category, r.count])).toEqual([["harassment", 12], ["safety", 5]]);
    expect(MIN_CATEGORY_COUNT).toBe(5);
    expect(s.someHidden).toBe(true);
  });

  it("does not let a hidden count be worked out from the total", () => {
    // 12 + 5 shown, 4 hidden: a total of 21 would reveal the 4, so there is no total and no "other" row.
    const s = publishableStats({ harassment: 12, safety: 5, retaliation: 4 });
    expect(s.total).toBeNull();
    expect(s.otherCategories).toBeNull();
  });

  it("shows one combined row (and the total) only when the hidden part is at least 5", () => {
    const s = publishableStats({ harassment: 12, safety: 3, retaliation: 4 });
    expect(s.otherCategories).toBe(7);
    expect(s.total).toBe(19);
  });

  it("shows the total when nothing is hidden, and handles an empty database", () => {
    expect(publishableStats({ harassment: 6, safety: 9 }).total).toBe(15);
    expect(publishableStats({})).toMatchObject({ rows: [], otherCategories: null, someHidden: false, total: 0 });
  });

  it("never shows any number for a category under 5, whatever the mix", () => {
    for (let a = 0; a < 5; a++) {
      for (let b = 0; b < 12; b++) {
        const s = publishableStats({ harassment: a, safety: b });
        for (const r of s.rows) expect(r.count).toBeGreaterThanOrEqual(5);
        if (a > 0 && a < 5 && b >= 5 && b > 0) expect(s.total === null || s.otherCategories !== null).toBe(true);
      }
    }
  });
});
