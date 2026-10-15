import { describe, expect, it } from "vitest";
import { retentionStage } from "./retention-rules";

const periods = { archiveAfterMonths: 60, anonymizeAfterMonths: 72 };
const base = { status: "separated", endDate: "2020-01-15", legalHold: false, anonymized: false };

describe("retentionStage", () => {
  it("keeps the record before five years", () => {
    expect(retentionStage(base, periods, new Date("2025-01-14T00:00:00Z"))).toBe("retained");
  });
  it("archives from five years after the end date", () => {
    expect(retentionStage(base, periods, new Date("2025-01-15T00:00:00Z"))).toBe("archive_due");
    expect(retentionStage(base, periods, new Date("2026-01-14T00:00:00Z"))).toBe("archive_due");
  });
  it("anonymizes from six years after the end date", () => {
    expect(retentionStage(base, periods, new Date("2026-01-15T00:00:00Z"))).toBe("anonymize_due");
  });
  it("never touches active people, people without an end date, held or already anonymized records", () => {
    const now = new Date("2040-01-01T00:00:00Z");
    expect(retentionStage({ ...base, status: "active" }, periods, now)).toBe("skip");
    expect(retentionStage({ ...base, endDate: null }, periods, now)).toBe("skip");
    expect(retentionStage({ ...base, legalHold: true }, periods, now)).toBe("skip");
    expect(retentionStage({ ...base, anonymized: true }, periods, now)).toBe("skip");
  });
  it("uses the configured periods", () => {
    expect(retentionStage(base, { archiveAfterMonths: 12, anonymizeAfterMonths: 24 }, new Date("2021-02-01T00:00:00Z"))).toBe("archive_due");
  });
});
