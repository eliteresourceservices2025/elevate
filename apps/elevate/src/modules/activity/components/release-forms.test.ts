import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("../release-actions", () => ({ createRelease: vi.fn(), publishRelease: vi.fn(), withdrawRelease: vi.fn(), deleteDraftRelease: vi.fn() }));

const { NewReleaseForm } = await import("./release-forms");
const { ReleasesTable } = await import("./releases-table");
import type { AdminRelease } from "../release-queries";

const policyVersions = [{ id: "11111111-1111-4111-8111-111111111111", label: "Version 2, published Nov 1, 2026" }];
const rel = (over: Partial<AdminRelease>): AdminRelease => ({
  id: "r1",
  version: "1.2.0",
  status: "draft",
  createdAt: "2026-11-20T10:00:00.000Z",
  publishedAt: null,
  minRequired: false,
  addsCollection: false,
  notes: { added: ["x"], improved: [], fixed: [] },
  platforms: ["windows-x86_64"],
  builds: [{ platform: "windows-x86_64", kind: "installer", sizeBytes: 9_000_000 }],
  ...over,
});

describe("NewReleaseForm", () => {
  it("has the version, three labelled note boxes, and the two checkboxes", () => {
    const html = renderToStaticMarkup(createElement(NewReleaseForm, { policyVersions }));
    expect(html).toContain("Version");
    for (const label of ["Added", "Improved", "Fixed"]) expect(html).toContain(label);
    expect((html.match(/<textarea/g) ?? []).length).toBe(3);
    expect(html).toContain("Required update");
    expect(html).toContain("Adds new data collection");
    expect(html).toContain("one change per line");
  });
  it("shows the policy choice only when new data collection is ticked", () => {
    expect(renderToStaticMarkup(createElement(NewReleaseForm, { policyVersions }))).not.toContain("Version 2, published Nov 1, 2026");
    expect(renderToStaticMarkup(createElement(NewReleaseForm, { policyVersions, initialAddsCollection: true }))).toContain("Version 2, published Nov 1, 2026");
  });
});

describe("ReleasesTable", () => {
  const html = renderToStaticMarkup(
    createElement(ReleasesTable, {
      releases: [rel({ id: "a", version: "1.3.0", status: "draft" }), rel({ id: "b", version: "1.2.0", status: "published", minRequired: true, publishedAt: "2026-11-20T10:00:00.000Z" }), rel({ id: "c", version: "1.1.0", status: "withdrawn", publishedAt: "2026-11-01T10:00:00.000Z" })],
      zone: "America/Phoenix",
    }),
  );
  it("offers Publish and Delete draft only on a draft, and Withdraw only on a published release", () => {
    expect((html.match(/>Publish</g) ?? []).length).toBe(1);
    expect((html.match(/>Delete draft</g) ?? []).length).toBe(1);
    expect((html.match(/>Withdraw</g) ?? []).length).toBe(1);
  });
  it("shows each status in words, the platforms with a build, and the required chip", () => {
    expect(html).toContain("Draft");
    expect(html).toContain("Published");
    expect(html).toContain("Withdrawn");
    expect(html).toContain("Windows");
    expect(html).toContain("Required");
  });
  it("escapes a version-like string and says when there are no releases", () => {
    const evil = renderToStaticMarkup(createElement(ReleasesTable, { releases: [rel({ version: "<i>9</i>" })], zone: "America/Phoenix" }));
    expect(evil).not.toContain("<i>9</i>");
    expect(renderToStaticMarkup(createElement(ReleasesTable, { releases: [], zone: "America/Phoenix" }))).toContain("No releases yet");
  });
});
