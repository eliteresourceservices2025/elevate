import { describe, expect, it } from "vitest";
import { describeChange } from "./history-format";
import { DEFAULT_PAYMENT_SORT, nextSort, PAYMENT_SORT_CHOICES, sortPayments, type SortablePayment } from "./payment-sort";
import { markPaidSchema } from "./validators";

// Invented people. How the Payment table of an approved run is ordered, what its column titles do, and what the Mark paid window may send.

const person = (name: string, clients: string, payment: SortablePayment["payment"] = null): SortablePayment => ({ name, clients, payment });
const rows = [
  person("Carla Cruz", "Zora Group", { paidOn: "2030-11-12", usdCents: "35166" }),
  person("Ana Abad", "Alturos Lab"),
  person("Ben Bautista", "Alturos Lab, Nourish Health", { paidOn: "2030-11-14", usdCents: null }),
  person("Dina Diaz", "No client", { paidOn: "2030-11-13", usdCents: "100000" }),
];
const names = (sort: Parameters<typeof sortPayments>[1]) => sortPayments(rows, sort).map((r) => r.name);

describe("sortPayments", () => {
  it("treats a skipped person like someone not paid: first for Not paid first, last for paid on and dollars", () => {
    const withSkip = [...rows, person("Eli Estrada", "Alturos Lab", { paidOn: "2030-11-15", usdCents: null, skipped: true })];
    const order = (sort: Parameters<typeof sortPayments>[1]) => sortPayments(withSkip, sort).map((r) => r.name);
    expect(order({ key: "status", dir: "asc" })).toEqual(["Ana Abad", "Eli Estrada", "Ben Bautista", "Carla Cruz", "Dina Diaz"]);
    expect(order({ key: "paid_on", dir: "desc" }).slice(-2)).toEqual(["Ana Abad", "Eli Estrada"]);
  });

  it("starts with the person's name A to Z, and can reverse it", () => {
    expect(names(DEFAULT_PAYMENT_SORT)).toEqual(["Ana Abad", "Ben Bautista", "Carla Cruz", "Dina Diaz"]);
    expect(names({ key: "name", dir: "desc" })).toEqual(["Dina Diaz", "Carla Cruz", "Ben Bautista", "Ana Abad"]);
  });

  it("sorts by client, then by name for the same client", () => {
    expect(names({ key: "client", dir: "asc" })).toEqual(["Ana Abad", "Ben Bautista", "Dina Diaz", "Carla Cruz"]);
    expect(names({ key: "client", dir: "desc" })).toEqual(["Carla Cruz", "Dina Diaz", "Ben Bautista", "Ana Abad"]);
  });

  it("puts the people not paid yet first, or last", () => {
    expect(names({ key: "status", dir: "asc" })[0]).toBe("Ana Abad");
    expect(names({ key: "status", dir: "desc" })[3]).toBe("Ana Abad");
  });

  it("sorts by the day paid, with the people not paid yet always last", () => {
    expect(names({ key: "paid_on", dir: "desc" })).toEqual(["Ben Bautista", "Dina Diaz", "Carla Cruz", "Ana Abad"]);
    expect(names({ key: "paid_on", dir: "asc" })).toEqual(["Carla Cruz", "Dina Diaz", "Ben Bautista", "Ana Abad"]);
  });

  it("sorts the dollars as numbers, with nothing recorded always last", () => {
    expect(names({ key: "usd", dir: "desc" })).toEqual(["Dina Diaz", "Carla Cruz", "Ana Abad", "Ben Bautista"]);
    expect(names({ key: "usd", dir: "asc" })).toEqual(["Carla Cruz", "Dina Diaz", "Ana Abad", "Ben Bautista"]);
  });

  it("does not change the list it was given", () => {
    const before = rows.map((r) => r.name);
    sortPayments(rows, { key: "client", dir: "desc" });
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("nextSort", () => {
  it("flips the direction of the column that is already sorted, and starts another column the useful way round", () => {
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "client")).toEqual({ key: "client", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "paid_on")).toEqual({ key: "paid_on", dir: "desc" });
    expect(nextSort({ key: "name", dir: "asc" }, "usd")).toEqual({ key: "usd", dir: "desc" });
  });

  it("has a menu choice for every column and direction used above", () => {
    expect(PAYMENT_SORT_CHOICES.map((c) => c.value)).toEqual(expect.arrayContaining(["name:asc", "client:desc", "status:asc", "paid_on:desc", "usd:desc"]));
  });
});

describe("the Mark paid window", () => {
  const base = { runId: "11111111-1111-4111-8111-111111111111", employeeId: "22222222-2222-4222-8222-222222222222", reference: "RMT-1", paidOn: "2030-11-12" };

  it("takes the dollars as an optional amount above zero", () => {
    expect(markPaidSchema.safeParse(base).success).toBe(true);
    expect(markPaidSchema.safeParse({ ...base, amountUsd: "" }).success).toBe(true);
    expect(markPaidSchema.parse({ ...base, amountUsd: " 351.66 " }).amountUsd).toBe("351.66");
    expect(markPaidSchema.safeParse({ ...base, amountUsd: "1,250.50" }).success).toBe(true);
    // A dollar sign and spaces typed with the amount read as typed.
    expect(markPaidSchema.parse({ ...base, amountUsd: "$351.66" }).amountUsd).toBe("351.66");
    expect(markPaidSchema.parse({ ...base, amountUsd: " $ 351.66 " }).amountUsd).toBe("351.66");
    expect(markPaidSchema.safeParse({ ...base, amountUsd: "351 66" }).success).toBe(false);
    for (const bad of ["abc", "0", "0.00", "-5", "12.345", "99999999999"]) expect(markPaidSchema.safeParse({ ...base, amountUsd: bad }).success, bad).toBe(false);
  });
});

describe("the change history", () => {
  const names2 = { user: () => null, employee: () => null } as unknown as Parameters<typeof describeChange>[2];

  it("shows the dollars recorded with a payment, and nothing when there were none", () => {
    const withUsd = describeChange("payment_marked", { paidOn: "2030-11-12", correction: false, usdCents: "35166" }, names2);
    expect(withUsd.facts).toEqual([{ label: "Paid on", value: "2030-11-12" }, { label: "Dollars paid", value: "$351.66" }]);
    const without = describeChange("payment_marked", { paidOn: "2030-11-12", correction: false }, names2);
    expect(without.facts.map((f) => f.label)).toEqual(["Paid on"]);
  });
});
