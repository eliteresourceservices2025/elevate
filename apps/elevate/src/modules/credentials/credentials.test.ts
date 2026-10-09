import { describe, expect, it } from "vitest";
import { planCredentialImport } from "./rules";
import { addCredentialSchema, importCredentialsSchema } from "./validators";

// Invented rows in the shape of TalentHR's assets file (headers as TalentHR names them, with its instruction row).
const HEAD = 'UUID,"Name *",Category,Label,Cost,Currency,"Purchase date","Warranty end date",Status,"Assignment Email","GUIDE ROW"';
const GUIDE = '"","REQUIRED. free text",,,,,,,,"OPTIONAL. email",yes';
const csv = (...rows: string[]) => [HEAD, GUIDE, ...rows].join("\n") + "\n";
const row = (name: string, bought: string, ends: string, email: string) => `x1,"${name}","Software and Licenses",L,30.00,USD,${bought},${ends},"In use",${email},no`;

describe("planCredentialImport", () => {
  it("makes certificates from assigned rows with an end date, and ignores prices and the instruction row", () => {
    const plan = planCredentialImport(csv(row("HIPAA Awareness Certificate", "01/22/2026", "01/22/2028", "Ana@Example.com")), "HIPAA");
    expect(plan).toEqual({
      ok: true,
      matchedFilter: 1,
      skipped: [],
      candidates: [{ row: 1, email: "ana@example.com", name: "HIPAA Awareness Certificate", issuedOn: "2026-01-22", expiresOn: "2028-01-22" }],
    });
  });

  it("looks only at rows whose name matches the filter, in any letter case", () => {
    const plan = planCredentialImport(csv(row("MacBook Air", "11/12/2025", "11/12/2027", "a@example.com"), row("hipaa course", "01/01/2026", "01/01/2027", "b@example.com")), "HIPAA");
    expect(plan.ok && plan.matchedFilter).toBe(1);
    expect(plan.ok && plan.candidates.map((c) => c.email)).toEqual(["b@example.com"]);
  });

  it("skips unassigned rows, rows with no valid end date and repeats, saying why", () => {
    const plan = planCredentialImport(
      csv(row("HIPAA cert", "01/01/2026", "01/01/2027", ""), row("HIPAA cert", "01/01/2026", "", "a@example.com"), row("HIPAA cert", "01/01/2026", "13/45/2027", "a@example.com"), row("HIPAA cert", "01/01/2026", "02/02/2027", "a@example.com"), row("HIPAA cert", "01/01/2026", "02/02/2027", "A@example.com")),
      "HIPAA",
    );
    expect(plan.ok && plan.candidates).toHaveLength(1);
    expect(plan.ok && plan.skipped.map((s) => s.reason)).toEqual(["Not assigned to a person", "No valid end date", "No valid end date", "Repeated in the file"]);
  });

  it("drops a purchase date that is after the end date or not a date", () => {
    const plan = planCredentialImport(csv(row("HIPAA cert", "05/05/2030", "05/05/2027", "a@example.com"), row("HIPAA cert 2", "not a date", "05/05/2027", "b@example.com")), "HIPAA");
    expect(plan.ok && plan.candidates.map((c) => c.issuedOn)).toEqual([null, null]);
  });

  it("explains a file that is not the assets file", () => {
    expect(planCredentialImport("Employee ID,Email\n1,a@example.com\n", "HIPAA")).toEqual({ ok: false, error: "This does not look like TalentHR's assets file: the Name and Assignment Email columns are missing." });
    expect(planCredentialImport('Name,"Assignment Email"\nx,y@example.com\n', "HIPAA")).toEqual({ ok: false, error: 'This file has no "Warranty end date" column, so there are no end dates to track.' });
  });
});

describe("validators", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("needs a real end date, not before the issue date", () => {
    expect(addCredentialSchema.safeParse({ employeeId: id, name: "HIPAA", expiresOn: "2027-02-30" }).success).toBe(false);
    expect(addCredentialSchema.safeParse({ employeeId: id, name: "HIPAA", issuedOn: "2027-03-01", expiresOn: "2027-02-01" }).success).toBe(false);
    expect(addCredentialSchema.safeParse({ employeeId: id, name: "HIPAA", issuedOn: "", expiresOn: "2027-02-01" }).success).toBe(true);
  });
  it("needs a name to filter by, so the import cannot read every row", () => {
    expect(importCredentialsSchema.safeParse({ csv: "x", nameContains: " ", commit: false }).success).toBe(false);
    expect(importCredentialsSchema.safeParse({ csv: "x", nameContains: "HIPAA", commit: true }).success).toBe(true);
  });
});
