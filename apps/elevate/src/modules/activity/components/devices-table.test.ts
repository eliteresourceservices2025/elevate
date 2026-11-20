import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("../actions", () => ({ revokeDevice: vi.fn() }));

const { DevicesTable } = await import("./devices-table");

const base = { id: "d1", employeeId: "e1", person: "Ana Reyes", name: "Work PC", os: "windows", appVersion: "1.0.0", lastSeenAt: "2026-11-10T10:00:00.000Z", status: "active", permissionsOk: true, queueSize: 0 };

describe("DevicesTable", () => {
  it("escapes a person's name", () => {
    const html = renderToStaticMarkup(createElement(DevicesTable, { rows: [{ ...base, person: "<script>x</script>" }], zone: "America/Phoenix" }));
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("shows missing permissions in words, and no Sign out button for a computer already signed out", () => {
    const html = renderToStaticMarkup(createElement(DevicesTable, { rows: [{ ...base, permissionsOk: false }, { ...base, id: "d2", status: "revoked" }], zone: "America/Phoenix" }));
    expect(html).toContain("Permission missing");
    expect((html.match(/Sign out/g) ?? []).length).toBe(1);
    expect(html).toContain("Signed out");
  });
});
