import { describe, expect, it } from "vitest";
import { approvalRefusal, runHash } from "./rules";

// Invented ids and figures only.
const clean = { blockingChecks: 0 };

describe("approvalRefusal", () => {
  it("lets anyone approve a clean run, whoever prepared or changed it", () => {
    expect(approvalRefusal(clean)).toBeNull();
  });

  it("refuses while blocking checks remain", () => {
    expect(approvalRefusal({ ...clean, blockingChecks: 1 })).toMatch(/must be fixed/);
  });
});

describe("runHash", () => {
  const lines = [
    { id: "b", payload: { net: 1_200_000n, items: [{ type: "loan", value: 50_000n }] } },
    { id: "a", payload: { net: 900_000n, nested: { z: 1, y: [2, 3] } } },
  ];

  it("is a hex SHA-256 that ignores line order and key order", () => {
    const h = runHash(lines);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(runHash([...lines].reverse())).toBe(h);
    expect(runHash([lines[0], { id: "a", payload: { nested: { y: [2, 3], z: 1 }, net: 900_000n } }])).toBe(h);
  });

  it("changes when a figure, a line or an item changes", () => {
    const h = runHash(lines);
    expect(runHash([lines[0], { id: "a", payload: { net: 900_001n, nested: { z: 1, y: [2, 3] } } }])).not.toBe(h);
    expect(runHash([lines[0]])).not.toBe(h);
    expect(runHash([{ id: "b", payload: { net: 1_200_000n, items: [{ type: "loan", value: 50_001n }] } }, lines[1]])).not.toBe(h);
  });

  it("tells a bigint apart from the same digits as a string", () => {
    expect(runHash([{ id: "a", payload: { v: 5n } }])).not.toBe(runHash([{ id: "a", payload: { v: "5" } }]));
  });
});
