import { describe, expect, it } from "vitest";
import { runChecks, type CheckLine, type ChecksInput } from "./checks";

// Invented people and figures only.
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const EMP_ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const line = (over: Partial<CheckLine> = {}): CheckLine => ({
  runLineId: "r1",
  employeeId: "e1",
  name: "Maria Testcruz",
  unreadable: false,
  issues: [],
  flags: [],
  net: 2_000_000n,
  previousNet: 2_000_000n,
  unapprovedDays: 0,
  payoutReady: true,
  pendingSuggestions: 0,
  clientHoursMissing: false,
  duplicateLine: false,
  confirmedBy: null,
  ...over,
});
const input = (lines: CheckLine[], over: Partial<ChecksInput> = {}): ChecksInput => ({
  lines,
  unassigned: [],
  submitter: { userId: ME, employeeId: EMP_ME },
  changeWarnBp: 1000,
  linesOutOfDate: false,
  ...over,
});
const codes = (r: { code: string }[]) => r.map((c) => c.code);

describe("runChecks", () => {
  it("a clean run has nothing to report", () => {
    expect(runChecks(input([line()]))).toEqual({ blocking: [], warnings: [] });
  });

  it("notes, without blocking, a partial cutoff that pays more than a full cutoff", () => {
    const r = runChecks(input([line({ issues: ["partial_exceeds_cutoff"] })]));
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([expect.objectContaining({ code: "partial_exceeds_cutoff", employeeId: "e1", runLineId: "r1" })]);
  });

  it("notes, without blocking, a missing multiplier and a negative total payable", () => {
    const r = runChecks(input([line({ issues: ["missing_multiplier:restDay", "negative_net"] })]));
    expect(r.blocking).toEqual([]);
    expect(codes(r.warnings).sort()).toEqual(["missing_multiplier", "negative_net"]);
    const multiplier = r.warnings.find((c) => c.code === "missing_multiplier")!;
    expect(multiplier.name).toBe("Maria Testcruz");
    expect(multiplier.detail).toBe("Overtime (OT), rest day");
  });

  it("notes, without blocking, suggestions nobody has assigned to a line", () => {
    const r = runChecks(input([line()], { unassigned: [{ employeeId: "e9", name: "Jose Dummy", count: 2 }] }));
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([expect.objectContaining({ code: "unassigned_suggestion", employeeId: "e9", name: "Jose Dummy" })]);
  });

  it("notes, without blocking, a submitter's own line that has no confirmation from someone else", () => {
    const own = (confirmedBy: string | null) => line({ employeeId: EMP_ME, runLineId: "mine", confirmedBy });
    expect(runChecks(input([own(null)])).blocking).toEqual([]);
    expect(codes(runChecks(input([own(null)])).warnings)).toEqual(["own_line_unconfirmed"]);
    // Confirmed by the submitter themselves does not count.
    expect(codes(runChecks(input([own(ME)])).warnings)).toEqual(["own_line_unconfirmed"]);
    expect(runChecks(input([own(OTHER)])).warnings).toEqual([]);
  });

  it("does not ask for a confirmation on someone else's line, or when the submitter has no people record", () => {
    expect(runChecks(input([line({ confirmedBy: null })])).blocking).toEqual([]);
    expect(runChecks(input([line({ employeeId: EMP_ME })], { submitter: { userId: ME, employeeId: null } })).blocking).toEqual([]);
  });

  it("warns, without blocking, about unapproved days, missing payout details, joiners and leavers, mid-period rate changes and pending suggestions", () => {
    const r = runChecks(
      input([
        line({ unapprovedDays: 2, payoutReady: false, flags: ["starts_mid_period", "rate_change_mid_period"], pendingSuggestions: 3 }),
        line({ runLineId: "r2", employeeId: "e2", flags: ["ends_mid_period"] }),
        line({ runLineId: "r3", employeeId: "e3", flags: ["person_left"] }),
      ]),
    );
    expect(r.blocking).toEqual([]);
    expect(codes(r.warnings).sort()).toEqual(
      ["new_or_leaving", "new_or_leaving", "new_or_leaving", "no_payout_details", "pending_suggestions", "rate_change_mid_period", "unapproved_days"].sort(),
    );
  });

  it("notes a line that has a client but no client payroll hours, without blocking", () => {
    const r = runChecks(input([line({ clientHoursMissing: true }), line({ runLineId: "r2", employeeId: "e2", clientHoursMissing: false })]));
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([{ code: "no_client_hours", employeeId: "e1", runLineId: "r1", name: "Maria Testcruz" }]);
  });

  it("warns, without blocking, about a person paid twice for the same client and alias", () => {
    const r = runChecks(input([line({ duplicateLine: true }), line({ runLineId: "r2", duplicateLine: true }), line({ runLineId: "r3", employeeId: "e3" })]));
    expect(r.blocking).toEqual([]);
    expect(r.warnings.map((c) => [c.code, c.runLineId])).toEqual([
      ["duplicate_pay_line", "r1"],
      ["duplicate_pay_line", "r2"],
    ]);
  });

  it("warns when net pay moved by more than the threshold from the last run, never at exactly the threshold", () => {
    const moved = (previousNet: bigint | null, net: bigint) => codes(runChecks(input([line({ previousNet, net })])).warnings);
    expect(moved(2_000_000n, 2_200_001n)).toEqual(["large_change"]);
    expect(moved(2_000_000n, 2_200_000n)).toEqual([]);
    expect(moved(2_000_000n, 1_799_999n)).toEqual(["large_change"]);
    expect(moved(2_000_000n, 1_800_000n)).toEqual([]);
    expect(moved(null, 9_999_999n)).toEqual([]); // no earlier run: nothing to compare with
    expect(moved(0n, 100n)).toEqual(["large_change"]);
    expect(moved(0n, 0n)).toEqual([]);
  });

  it("uses the threshold it is given", () => {
    const r = runChecks(input([line({ previousNet: 1_000_000n, net: 1_060_000n })], { changeWarnBp: 500 }));
    expect(codes(r.warnings)).toEqual(["large_change"]);
  });

  it("blocks on a line that can't be read, and skips the checks that need its figures", () => {
    const r = runChecks(input([line({ unreadable: true, net: null, previousNet: 5n, payoutReady: false })]));
    expect(codes(r.blocking)).toEqual(["unreadable_line"]);
    expect(codes(r.warnings)).toEqual(["no_payout_details"]);
  });

  it("notes, for the whole run and without blocking, when the pay lines changed after the run was created", () => {
    const r = runChecks(input([line()], { linesOutOfDate: true }));
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([expect.objectContaining({ code: "lines_out_of_date", employeeId: null, runLineId: null })]);
    expect(runChecks(input([line()], { linesOutOfDate: false })).warnings).toEqual([]);
  });

  it("never puts an amount in a message", () => {
    const r = runChecks(input([line({ previousNet: 1_000_000n, net: 9_876_543n })]));
    expect(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/9876543|98,765/);
  });
});
