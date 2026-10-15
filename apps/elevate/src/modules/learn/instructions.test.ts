import { describe, expect, it } from "vitest";
import { buildLearnerInstructions, type InstructionFacts } from "./instructions";

const hipaa: InstructionFacts = {
  slug: "hipaa",
  kind: "core",
  label: "HIPAA",
  noun: "HIPAA training",
  clientName: null,
  minutes: 125,
  exam: { questions: 20, passPercent: 80, maxTries: 3, waitMinutes: 60 },
  renewalMonths: 24,
};

describe("instructions for learners", () => {
  it("states the real course rules and never an account or password", () => {
    const t = buildLearnerInstructions(hipaa);
    expect(t).toContain("HIPAA");
    expect(t).toContain("about 2 hours");
    expect(t).toContain("20 questions");
    expect(t).toContain("80%");
    expect(t).toContain("3 tries");
    expect(t).toContain("60-minute wait");
    expect(t).toContain("24 months");
    expect(t).toContain("There is no separate account or password to remember");
    expect(t).not.toMatch(/username|http|www\./i);
  });

  it("describes a client add-on with its client, and an acknowledgment-only one without an exam", () => {
    const addon: InstructionFacts = { ...hipaa, slug: "acme-requirements", kind: "client_addon", label: "Acme requirements", noun: "Acme requirements training", clientName: "Acme Dental", minutes: 20, exam: null, renewalMonths: 12 };
    const t = buildLearnerInstructions(addon);
    expect(t).toContain("Acme Dental");
    expect(t).toContain("Acme requirements");
    expect(t).toContain("There is no exam for this course");
    expect(t).not.toContain("final exam");
    expect(t).toContain("about 20 minutes");
  });

  it("leaves out what is unknown instead of guessing", () => {
    const t = buildLearnerInstructions({ ...hipaa, minutes: null, renewalMonths: null });
    expect(t).not.toContain("takes about");
    expect(t).not.toContain("months");
  });
});
