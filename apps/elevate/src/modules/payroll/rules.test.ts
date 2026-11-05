import { describe, expect, it } from "vitest";
import { approvalRefusal, runHash } from "./rules";

// Invented ids and figures only.
const APPROVER = "11111111-1111-4111-8111-111111111111";
const PREPARER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const clean = { approverId: APPROVER, touchedBy: [PREPARER, OTHER], ownLines: [], blockingChecks: 0 };

describe("approvalRefusal", () => {
  it("lets someone who never touched the run approve a clean run", () => {
    expect(approvalRefusal(clean)).toBeNull();
  });

  it("refuses anyone who prepared or changed the run, whatever their level is now", () => {
    expect(approvalRefusal({ ...clean, touchedBy: [PREPARER, APPROVER] })).toMatch(/prepared or changed this run/);
  });

  it("refuses when the approver's own line is unconfirmed or was confirmed by the approver", () => {
    expect(approvalRefusal({ ...clean, ownLines: [{ confirmedBy: null }] })).toMatch(/your own line/i);
    expect(approvalRefusal({ ...clean, ownLines: [{ confirmedBy: OTHER }, { confirmedBy: APPROVER }] })).toMatch(/your own line/i);
  });

  it("allows an own line that another Preparer confirmed", () => {
    expect(approvalRefusal({ ...clean, ownLines: [{ confirmedBy: OTHER }] })).toBeNull();
  });

  it("refuses while blocking checks remain", () => {
    expect(approvalRefusal({ ...clean, blockingChecks: 1 })).toMatch(/must be fixed/);
  });

  it("names the separation-of-duties reason before the checks", () => {
    expect(approvalRefusal({ ...clean, touchedBy: [APPROVER], blockingChecks: 3 })).toMatch(/prepared or changed/);
  });
});

describe("runHash", () => {
  const lines = [
    { id: "b", payload: { net: 1_200_000n, items: [{ type: "loan", value: 50_000n }] } },
    { id: "a", payload: { net: 900_000n, nested: { z: 1, y: [2, 3] } } },
  ];

  it("is a hex SHA-256 that ignores line order and key order", () => {
    const h = runHash(lines, 585_000);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(runHash([...lines].reverse(), 585_000)).toBe(h);
    expect(runHash([lines[0], { id: "a", payload: { nested: { y: [2, 3], z: 1 }, net: 900_000n } }], 585_000)).toBe(h);
  });

  it("changes when a figure, a line, an item, or the dollar rate changes", () => {
    const h = runHash(lines, 585_000);
    expect(runHash([lines[0], { id: "a", payload: { net: 900_001n, nested: { z: 1, y: [2, 3] } } }], 585_000)).not.toBe(h);
    expect(runHash([lines[0]], 585_000)).not.toBe(h);
    expect(runHash([{ id: "b", payload: { net: 1_200_000n, items: [{ type: "loan", value: 50_001n }] } }, lines[1]], 585_000)).not.toBe(h);
    expect(runHash(lines, 585_001)).not.toBe(h);
    expect(runHash(lines, null)).not.toBe(h);
  });

  it("tells a bigint apart from the same digits as a string", () => {
    expect(runHash([{ id: "a", payload: { v: 5n } }], null)).not.toBe(runHash([{ id: "a", payload: { v: "5" } }], null));
  });
});
