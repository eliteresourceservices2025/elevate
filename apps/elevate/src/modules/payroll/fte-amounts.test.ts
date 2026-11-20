import { describe, expect, it, vi } from "vitest";
import { describeChange } from "./history-format";
import { createPayLineSchema, setLineFtesSchema, updatePayLineSchema } from "./validators";

vi.mock("server-only", () => ({}));
const { amountsToJson } = await import("./service");

// Invented figures. How a rate keeps its FTE count and its amount per FTE, what the forms may send, and how a change reads in the history.

const EMP = "11111111-1111-4111-8111-111111111111";
const LINE = "22222222-2222-4222-8222-222222222222";
const base = { employeeId: EMP, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2030-11-01" };

describe("what a rate keeps", () => {
  it("writes the FTE count and the amount per FTE only when they are set, so older rates keep their shape", () => {
    expect(amountsToJson({ monthlyCentavos: 100n })).toEqual({ monthlyCentavos: "100" });
    expect(amountsToJson({ monthlyCentavos: 100n, fteHundredths: 50 })).toEqual({ monthlyCentavos: "100", fteHundredths: 50 });
    expect(amountsToJson({ monthlyCentavos: 100n, fteHundredths: 0 })).toEqual({ monthlyCentavos: "100", fteHundredths: 0 }); // 0 is a real count
    expect(amountsToJson({ monthlyCentavos: 0n, perFteCentavos: 150_000n })).toEqual({ monthlyCentavos: "0", perFteCentavos: "150000" });
  });

  it("drops a count that is not a whole number of hundredths from 0 to 200, and an amount per FTE that is not above zero", () => {
    expect(amountsToJson({ monthlyCentavos: 100n, fteHundredths: 250 })).toEqual({ monthlyCentavos: "100" });
    expect(amountsToJson({ monthlyCentavos: 100n, fteHundredths: -1 })).toEqual({ monthlyCentavos: "100" });
    expect(amountsToJson({ monthlyCentavos: 100n, fteHundredths: 0.5 })).toEqual({ monthlyCentavos: "100" });
    expect(amountsToJson({ monthlyCentavos: 0n, perFteCentavos: 0n })).toEqual({ monthlyCentavos: "0" });
  });
});

describe("the rate forms", () => {
  it("takes a monthly rate with an optional FTE count, as before (a rate sent without a basis is a monthly rate)", () => {
    const parsed = createPayLineSchema.safeParse({ ...base, monthly: "25,000.00", fte: "0.5" });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ basis: "monthly", monthly: "25,000.00", fte: 50 });
    expect(createPayLineSchema.parse({ ...base, monthly: "25,000.00" }).fte).toBeUndefined();
    expect(createPayLineSchema.parse({ ...base, monthly: "25,000.00", fte: "" }).fte).toBeNull(); // blank = not set
  });

  it("refuses a count that is not 1, 0.5 or 0 and the like (0 to 2), and a monthly rate that is blank or zero", () => {
    for (const fte of ["3", "-1", "abc", "2.5"]) expect(createPayLineSchema.safeParse({ ...base, monthly: "25,000", fte }).success, fte).toBe(false);
    for (const monthly of ["", "0", "0.00", "abc"]) expect(createPayLineSchema.safeParse({ ...base, monthly }).success, monthly).toBe(false);
  });

  it("takes an internal-team rate as an amount per FTE, and then needs that amount instead of a monthly rate", () => {
    const ok = createPayLineSchema.safeParse({ ...base, basis: "per_fte", perFte: "1,500.00" });
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ basis: "per_fte", perFte: "1,500.00" });
    expect(createPayLineSchema.safeParse({ ...base, basis: "per_fte", perFte: "" }).success).toBe(false);
    expect(createPayLineSchema.safeParse({ ...base, basis: "per_fte", perFte: "0" }).success).toBe(false);
    expect(createPayLineSchema.safeParse({ ...base, basis: "per_fte", monthly: "25,000" }).success).toBe(false); // a monthly rate alone is not enough
    expect(createPayLineSchema.safeParse({ ...base, basis: "daily", monthly: "25,000" }).success).toBe(false);
  });

  it("applies the same rules when a rate is updated", () => {
    const update = { lineKey: LINE, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2030-11-01", reason: "Raise" };
    expect(updatePayLineSchema.safeParse({ ...update, basis: "per_fte", perFte: "1,600" }).success).toBe(true);
    expect(updatePayLineSchema.safeParse({ ...update, basis: "per_fte" }).success).toBe(false);
    expect(updatePayLineSchema.safeParse({ ...update, monthly: "30,000", fte: "1" }).success).toBe(true);
  });

  it("takes the Set FTE table as rows of a line and a count, 1 to 300 of them; a blank count clears it", () => {
    expect(setLineFtesSchema.parse({ rows: [{ lineKey: LINE, fte: "0.5" }] })).toEqual({ rows: [{ lineKey: LINE, fte: 50 }] });
    expect(setLineFtesSchema.parse({ rows: [{ lineKey: LINE, fte: "" }] })).toEqual({ rows: [{ lineKey: LINE, fte: null }] });
    for (const rows of [[], [{ lineKey: LINE, fte: "3" }], [{ lineKey: "nope", fte: "1" }], Array.from({ length: 301 }, () => ({ lineKey: LINE, fte: "1" }))]) {
      expect(setLineFtesSchema.safeParse({ rows }).success).toBe(false);
    }
  });
});

describe("the change history", () => {
  const names = { user: () => null, employee: () => null, client: () => null } as unknown as Parameters<typeof describeChange>[2];
  const version = { monthlyCentavos: "2500000", hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2030-11-01", endsOn: null, alias: null, clientId: null };

  it("shows a changed FTE count, and a first count as going from Not set", () => {
    const set = describeChange("line_updated", { old: version, new: { ...version, fteHundredths: 50 }, reason: "FTE set" }, names);
    expect(set.changes).toEqual([{ label: "FTE", before: "Not set", after: "0.5" }]);
    const changed = describeChange("line_updated", { old: { ...version, fteHundredths: 50 }, new: { ...version, fteHundredths: 100 }, reason: "FTE set" }, names);
    expect(changed.changes).toEqual([{ label: "FTE", before: "0.5", after: "1" }]);
  });

  it("shows the amount per FTE of an internal-team rate, and no FTE row for it", () => {
    const r = describeChange("line_created", { new: { ...version, monthlyCentavos: "0", perFteCentavos: "150000" } }, names);
    const labels = r.changes.map((c) => c.label);
    expect(r.changes.find((c) => c.label === "Amount per FTE (pesos)")).toMatchObject({ after: "1,500.00" });
    expect(labels).not.toContain("FTE");
  });
});
