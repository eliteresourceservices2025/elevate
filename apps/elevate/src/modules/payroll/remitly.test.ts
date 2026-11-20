import { describe, expect, it } from "vitest";
import { buildRemitlyRows, REMITLY_HEADER, type PayoutDetails } from "./remitly";

// Invented people and figures. Pesos are bigint centavos. The list is in pesos only (Remitly applies its own rate).
const line = (employeeId: string, name: string, alias: string | null, net: bigint) => ({
  employeeId,
  name,
  alias,
  net,
});

describe("buildRemitlyRows", () => {
  it("gives a person with two lines one row with both lines summed and both aliases", () => {
    const rows = buildRemitlyRows([line("e1", "Liza Testreyes", "Front desk", 1_250_050n), line("e1", "Liza Testreyes", "Billing", 500_000n)]);
    expect(rows).toEqual([
      {
        employeeId: "e1",
        name: "Liza Testreyes",
        aliases: "Front desk; Billing",
        pesos: "17500.50",
        bankName: "",
        accountName: "",
        accountNumber: "",
      },
    ]);
  });

  it("gives each person their own row, in name order", () => {
    const rows = buildRemitlyRows([line("e2", "Ben Zamora", null, 585_000n), line("e1", "Ana Cruz", null, 1_170_000n)]);
    expect(rows.map((r) => [r.employeeId, r.pesos, r.aliases])).toEqual([
      ["e1", "11700.00", ""],
      ["e2", "5850.00", ""],
    ]);
  });

  it("keeps two people with the same name as two rows", () => {
    const rows = buildRemitlyRows([line("e1", "Ana Cruz", null, 585_000n), line("e2", "Ana Cruz", null, 585_000n)]);
    expect(rows.map((r) => r.employeeId)).toEqual(["e1", "e2"]);
  });

  it("lists a repeated alias once and leaves out blank ones", () => {
    const rows = buildRemitlyRows([
      line("e1", "A B", "Desk", 100n),
      line("e1", "A B", "Desk", 100n),
      line("e1", "A B", "  ", 100n),
      line("e1", "A B", null, 100n),
    ]);
    expect(rows[0].aliases).toBe("Desk");
    expect(rows[0].pesos).toBe("4.00");
  });

  it("has the bank columns but no dollar column, blank when the person has no details", () => {
    const keys = Object.keys(buildRemitlyRows([line("e1", "A B", null, 100n)])[0]);
    expect(keys).toEqual(["employeeId", "name", "aliases", "pesos", "bankName", "accountName", "accountNumber"]);
    expect(REMITLY_HEADER).toEqual(["Person", "Alias", "Pesos", "Bank", "Account name", "Account number"]);
    expect(buildRemitlyRows([line("e1", "A B", null, 100n)])[0]).toMatchObject({ bankName: "", accountName: "", accountNumber: "" });
  });

  it("puts each person's payout details on their own row, and only theirs", () => {
    const details = new Map<string, PayoutDetails>([["e1", { bankName: "Test Bank", accountName: "Ana Cruz", accountNumber: "0012345678" }]]);
    const rows = buildRemitlyRows([line("e1", "Ana Cruz", null, 585_000n), line("e1", "Ana Cruz", "Billing", 100n), line("e2", "Ben Zamora", null, 100n)], details);
    expect(rows.map((r) => [r.employeeId, r.bankName, r.accountName, r.accountNumber])).toEqual([
      ["e1", "Test Bank", "Ana Cruz", "0012345678"],
      ["e2", "", "", ""],
    ]);
  });
});
