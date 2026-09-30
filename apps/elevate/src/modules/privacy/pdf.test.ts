import { describe, expect, it } from "vitest";
import { latin, renderMyDataPdf, wrapText } from "./pdf";
import type { MyData } from "./types";

const sample = (over: Partial<MyData> = {}): MyData => ({
  generatedAt: "2026-10-01T00:00:00.000Z",
  account: { email: "ana@example.com" },
  profile: {
    employeeNumber: "ERS-0001",
    legalFirstName: "Ana",
    legalMiddleName: null,
    legalLastName: "Dela Cruz",
    preferredName: null,
    birthDate: "1995-03-04",
    civilStatus: "single",
    workEmail: "ana@example.com",
    personalEmail: null,
    mobile: "+63 900 000 0000",
    address: "1 Sample Street, Makati, Metro Manila, 1200, PH",
    status: "active",
    workerType: "contractor",
    position: "Virtual Assistant",
    team: "Support",
    manager: "Ben Reyes",
    startDate: "2025-01-06",
    endDate: null,
  },
  sensitive: [{ field: "tin", label: "TIN", masked: "•••-1234" }],
  history: [{ date: "2025-01-06", event: "hired", summary: "Hired" }],
  emergencyContacts: [{ name: "Maria", relationship: "Mother", phone: "0900", primary: true }],
  clients: [],
  documents: [],
  acknowledgments: [],
  requests: [],
  activity: [],
  ...over,
});

describe("latin", () => {
  it("keeps Latin text and replaces what the standard font cannot draw", () => {
    expect(latin("José Peña")).toBe("José Peña");
    expect(latin("Ana 😀 日本")).toBe("Ana ?? ??"); // an emoji is two code units
    expect(latin("a\nb\tc")).toBe("a b c");
    expect(latin("•••-1234")).toBe("***-1234"); // mask bullets are not in the font
  });
});

describe("wrapText", () => {
  const measure = (s: string) => s.length * 5;
  it("wraps on spaces", () => {
    expect(wrapText("aaa bbb ccc", 40, measure)).toEqual(["aaa bbb", "ccc"]);
  });
  it("splits a word that is wider than the line", () => {
    const lines = wrapText("x".repeat(30), 50, measure);
    expect(lines.every((l) => measure(l) <= 50)).toBe(true);
    expect(lines.join("")).toBe("x".repeat(30));
  });
  it("returns one empty line for nothing", () => {
    expect(wrapText("", 50, measure)).toEqual([""]);
  });
});

describe("renderMyDataPdf", () => {
  it("produces a PDF", async () => {
    const bytes = await renderMyDataPdf(sample());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("copes with no profile, odd characters and very long lists", async () => {
    const bytes = await renderMyDataPdf(
      sample({
        profile: null,
        history: Array.from({ length: 300 }, (_, i) => ({ date: "2026-01-01", event: "profile_changed", summary: `Change ${i} 日本語 😀 ${"long ".repeat(40)}` })),
        emergencyContacts: [{ name: "Zoë 日本", relationship: "Friend", phone: "0", primary: false }],
      }),
    );
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5000);
  });
});
