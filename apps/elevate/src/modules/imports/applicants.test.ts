import { describe, expect, it } from "vitest";
import { activeApplicants, isTerminalStep, stageForStep } from "./applicants";

const steps = [
  { id: 1, name: "Applied", slug: "applied" },
  { id: 2, name: "Phone Screening", slug: "phone-screening" },
  { id: 3, name: "Final Interview", slug: "final-interview" },
  { id: 4, name: "Skills Test", slug: "skills-test" },
  { id: 5, name: "Offer Sent", slug: "offer-sent" },
  { id: 6, name: "Hired", slug: "hired" },
  { id: 7, name: "Not selected", slug: "not-selected" },
];

describe("stageForStep", () => {
  it("maps TalentHR steps to ELEVATE stages", () => {
    expect(stageForStep("Applied", "applied")).toBe("applied");
    expect(stageForStep("Phone Screening")).toBe("screening");
    expect(stageForStep("Final Interview")).toBe("interview");
    expect(stageForStep("Skills Test")).toBe("assessment");
    expect(stageForStep("Offer Sent")).toBe("offer");
    expect(stageForStep("Something custom")).toBe("applied");
    expect(stageForStep(null, null)).toBe("applied");
  });
});

describe("isTerminalStep", () => {
  it("recognises endings", () => {
    for (const n of ["Hired", "Rejected", "Disqualified", "Declined offer", "Withdrawn", "Not selected", "Talent pool", "Archived"]) expect(isTerminalStep(n)).toBe(true);
    for (const n of ["Applied", "Interview", "Offer Sent", "Phone Screening"]) expect(isTerminalStep(n)).toBe(false);
  });
});

describe("activeApplicants", () => {
  const row = (id: number, step: number | null, over: Record<string, unknown> = {}) => ({ email: `p${id}@example.com`, application: { id, application_step_id: step, is_disqualified: false, deleted_at: null, ...over } });
  it("keeps only live applications with an email and a step that is not an ending", () => {
    const rows = [row(1, 1), row(2, 2), row(3, 6), row(4, 7), row(5, 1, { is_disqualified: true }), row(6, 1, { deleted_at: "2026-01-01" }), { email: "no-app@example.com", application: null }, { ...row(8, 1), email: "not-an-email" }, row(9, null)];
    const out = activeApplicants(rows, steps);
    expect(out.map((o) => [o.row.application!.id, o.stage])).toEqual([[1, "applied"], [2, "screening"], [9, "applied"]]);
  });
});
