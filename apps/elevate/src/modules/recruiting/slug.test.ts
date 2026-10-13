import { describe, expect, it } from "vitest";
import { SLUG_MAX, SLUG_PATTERN, careerPath, looksLikeId, slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("makes a readable address from a title", () => {
    expect(slugify("Virtual Assistant (Medical Billing)")).toBe("virtual-assistant-medical-billing");
    expect(slugify("  Sr. Customer-Support / Chat Agent  ")).toBe("sr-customer-support-chat-agent");
    expect(slugify("Admin & Scheduling")).toBe("admin-and-scheduling");
  });
  it("drops accents and symbols, and never returns an empty address", () => {
    expect(slugify("Asistente Virtual Médico")).toBe("asistente-virtual-medico");
    expect(slugify("!!!")).toBe("job");
    expect(slugify("")).toBe("job");
  });
  it("stays within the limit and never ends on a dash", () => {
    const long = slugify("Executive Virtual Assistant for a busy healthcare practice with many locations and clinics across the country");
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(long.endsWith("-")).toBe(false);
    expect(SLUG_PATTERN.test(long)).toBe(true);
  });
  it("only produces addresses the pattern accepts", () => {
    for (const t of ["A", "a b c", "VA #1", "Ünïcödé", "100% Remote"]) expect(SLUG_PATTERN.test(slugify(t))).toBe(true);
  });
});

describe("uniqueSlug", () => {
  it("keeps a free address and numbers a taken one", () => {
    expect(uniqueSlug("va", new Set())).toBe("va");
    expect(uniqueSlug("va", new Set(["va"]))).toBe("va-2");
    expect(uniqueSlug("va", new Set(["va", "va-2", "va-3"]))).toBe("va-4");
  });
  it("keeps a numbered address within the limit", () => {
    const base = "a".repeat(SLUG_MAX);
    const next = uniqueSlug(base, new Set([base]));
    expect(next.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(next.endsWith("-2")).toBe(true);
  });
});

describe("addresses", () => {
  it("tells an id from a readable address", () => {
    expect(looksLikeId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(looksLikeId("virtual-assistant")).toBe(false);
  });
  it("links by the readable address, else by id", () => {
    expect(careerPath({ id: "x", slug: "va" })).toBe("/careers/va");
    expect(careerPath({ id: "11111111-1111-4111-8111-111111111111", slug: null })).toBe("/careers/11111111-1111-4111-8111-111111111111");
  });
});
