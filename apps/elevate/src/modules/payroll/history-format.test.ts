import { describe, expect, it } from "vitest";
import { describeChange } from "./history-format";

// How a change of the payslip signatory reads on the history page. Invented names.

const names = { user: () => null, employee: () => null } as unknown as Parameters<typeof describeChange>[2];

describe("describeChange: signatory_changed", () => {
  it("lists only what changed, and never a picture", () => {
    const r = describeChange(
      "signatory_changed",
      { old: { name: "Carmen Dela Rosa", title: "HR Director", hasSignature: false }, new: { name: "Carmen Dela Rosa", title: "Human Resources Director", hasSignature: true }, signatureChanged: true },
      names,
    );
    expect(r.changes).toEqual([
      { label: "Signatory title", before: "HR Director", after: "Human Resources Director" },
      { label: "Signature picture", before: "None", after: "On file" },
    ]);
  });

  it("shows a first setup as going from Not set", () => {
    const r = describeChange("signatory_changed", { old: null, new: { name: "Carmen Dela Rosa", title: "Human Resources Director", hasSignature: false }, signatureChanged: false }, names);
    expect(r.changes.map((c) => [c.label, c.before, c.after])).toEqual([
      ["Signatory name", "Not set", "Carmen Dela Rosa"],
      ["Signatory title", "Not set", "Human Resources Director"],
    ]);
  });
});
