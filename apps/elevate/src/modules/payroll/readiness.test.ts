import { describe, expect, it } from "vitest";
import type { RunCheck } from "./checks";
import { groupReadiness } from "./readiness";

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const L1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const L2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const check = (code: RunCheck["code"], name: string, employeeId: string | null, runLineId: string | null): RunCheck => ({ code, name, employeeId, runLineId });

describe("groupReadiness", () => {
  it("groups by person, splits must-fix from review, and counts", () => {
    const r = groupReadiness(
      [check("unreadable_line", "Ben", E2, L2)],
      [check("large_change", "Ana", E1, L1), check("pending_suggestions", "Ana", E1, L1), check("no_payout_details", "Ben", E2, L2)],
    );
    expect(r.mustCount).toBe(1);
    expect(r.reviewCount).toBe(3);
    expect(r.peopleCount).toBe(2);
    // Ben has a must-fix, so he is listed first.
    expect(r.people.map((p) => p.name)).toEqual(["Ben", "Ana"]);
    expect(r.people[0].must.map((c) => c.code)).toEqual(["unreadable_line"]);
    // The easy-to-overlook check comes before the other one for Ana, and is marked.
    expect(r.people[1].review.map((c) => [c.code, c.priority])).toEqual([
      ["pending_suggestions", true],
      ["large_change", false],
    ]);
  });

  it("keeps run-level checks apart from people", () => {
    const r = groupReadiness([], [check("lines_out_of_date", "This run", null, null), check("negative_net", "Ana", E1, L1)]);
    expect(r.runLevel.review.map((c) => c.code)).toEqual(["lines_out_of_date"]);
    expect(r.peopleCount).toBe(1);
  });

  it("shows a person with two lines once for each line, so a link goes to the right row", () => {
    const r = groupReadiness([], [check("no_client_hours", "Ana", E1, L1), check("no_client_hours", "Ana", E1, L2)]);
    expect(r.people.map((p) => p.runLineId)).toEqual([L1, L2]);
  });

  it("is empty when nothing is wrong", () => {
    expect(groupReadiness([], [])).toMatchObject({ mustCount: 0, reviewCount: 0, peopleCount: 0, people: [] });
  });
});
