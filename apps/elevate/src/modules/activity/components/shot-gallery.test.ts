import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The gallery only imports the server action here, never calls it.
vi.mock("../shot-actions", () => ({ viewShot: vi.fn() }));

const { ShotGallery } = await import("./shot-gallery");

const shots = [
  { id: "11111111-1111-4111-8111-111111111111", takenAt: "2026-11-10T17:05:00.000Z" },
  { id: "22222222-2222-4222-8222-222222222222", takenAt: "2026-11-10T17:25:00.000Z" },
];

describe("ShotGallery", () => {
  const html = renderToStaticMarkup(createElement(ShotGallery, { shots, zone: "America/Phoenix", needReason: false }));
  it("shows one button per screenshot, labelled with the time in the given zone", () => {
    expect((html.match(/<button/g) ?? []).length).toBe(2);
    expect(html).toContain("10:05 AM");
    expect(html).toContain("10:25 AM");
  });
  it("shows no picture and no storage address before anything is opened", () => {
    expect(html).not.toContain("<img");
    expect(html).not.toContain("activity-shots");
    expect(html).not.toContain("supabase");
  });
  it("says so when there are none", () => {
    expect(renderToStaticMarkup(createElement(ShotGallery, { shots: [], zone: "America/Phoenix", needReason: false }))).toContain("No screenshots");
  });
});
