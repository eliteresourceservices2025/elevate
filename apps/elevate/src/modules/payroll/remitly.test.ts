import { describe, expect, it } from "vitest";
import { buildRemitlyRows } from "./remitly";

// Invented people and figures. Pesos are bigint centavos; the rate is the dollar rate times 10,000 (58.50 = 585000).
const line = (employeeId: string, name: string, alias: string | null, net: bigint) => ({
  employeeId,
  name,
  alias,
  net,
});

describe("buildRemitlyRows", () => {
  it("gives a person with two lines one row with both lines summed and both aliases", () => {
    const rows = buildRemitlyRows(
      [
        line("e1", "Liza Testreyes", "Front desk", 1_250_050n),
        line("e1", "Liza Testreyes", "Billing", 500_000n),
      ],
      585_000,
    );
    expect(rows).toEqual([
      {
        employeeId: "e1",
        name: "Liza Testreyes",
        aliases: "Front desk; Billing",
        pesos: "17500.50",
        dollars: "299.15",
      },
    ]);
  });

  it("gives each person their own row, in name order", () => {
    const rows = buildRemitlyRows(
      [line("e2", "Ben Zamora", null, 585_000n), line("e1", "Ana Cruz", null, 1_170_000n)],
      585_000,
    );
    expect(rows.map((r) => [r.employeeId, r.pesos, r.dollars, r.aliases])).toEqual([
      ["e1", "11700.00", "200.00", ""],
      ["e2", "5850.00", "100.00", ""],
    ]);
  });

  it("rounds dollars half up in cents", () => {
    // 0.25 pesos at 50.00 is exactly half a cent.
    expect(buildRemitlyRows([line("e1", "A B", null, 25n)], 500_000)[0].dollars).toBe("0.01");
    // 0.24 pesos at 50.00 is under half a cent.
    expect(buildRemitlyRows([line("e1", "A B", null, 24n)], 500_000)[0].dollars).toBe("0.00");
  });

  it("rounds a person's total once, not each line", () => {
    // Two lines of 0.25 pesos at 50.00: each alone is half a cent (0.01), but together 0.50 pesos is exactly one cent.
    const rows = buildRemitlyRows(
      [line("e1", "A B", "One", 25n), line("e1", "A B", "Two", 25n)],
      500_000,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].pesos).toBe("0.50");
    expect(rows[0].dollars).toBe("0.01");
  });

  it("keeps two people with the same name as two rows", () => {
    const rows = buildRemitlyRows(
      [line("e1", "Ana Cruz", null, 585_000n), line("e2", "Ana Cruz", null, 585_000n)],
      585_000,
    );
    expect(rows.map((r) => r.employeeId)).toEqual(["e1", "e2"]);
  });

  it("lists a repeated alias once and leaves out blank ones", () => {
    const rows = buildRemitlyRows(
      [
        line("e1", "A B", "Desk", 100n),
        line("e1", "A B", "Desk", 100n),
        line("e1", "A B", "  ", 100n),
        line("e1", "A B", null, 100n),
      ],
      585_000,
    );
    expect(rows[0].aliases).toBe("Desk");
    expect(rows[0].pesos).toBe("4.00");
  });

  it("has no bank or account column", () => {
    const keys = Object.keys(buildRemitlyRows([line("e1", "A B", null, 100n)], 585_000)[0]);
    expect(keys).toEqual(["employeeId", "name", "aliases", "pesos", "dollars"]);
  });

  it("refuses a missing or non-positive rate", () => {
    expect(() => buildRemitlyRows([line("e1", "A B", null, 100n)], null)).toThrow();
    expect(() => buildRemitlyRows([line("e1", "A B", null, 100n)], 0)).toThrow();
  });
});
