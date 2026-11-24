import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DownloadHero } from "./download-hero";
import type { PublishedRelease } from "../releases-service";

const build = (platform: "windows-x86_64" | "darwin-aarch64" | "darwin-x86_64", kind: "installer" | "update" = "installer") => ({
  platform,
  kind,
  sizeBytes: 8_800_000,
  sha256: "ab".repeat(32),
  signature: kind === "update" ? "SIG" : null,
  storagePath: `releases/1.2.0/${platform}/${kind}/secret-path.exe`,
  fileName: "secret-path.exe",
});
const release = (builds = [build("windows-x86_64"), build("darwin-aarch64")]): PublishedRelease => ({
  id: "r1",
  version: "1.2.0",
  publishedAt: "2026-11-20T10:00:00.000Z",
  status: "published",
  minRequired: false,
  notes: { added: ["x"], improved: [], fixed: [] },
  builds,
});
const render = (os: "windows" | "mac" | "other", current: PublishedRelease | PublishedRelease[] | null) =>
  renderToStaticMarkup(createElement(DownloadHero, { os, releases: current === null ? [] : Array.isArray(current) ? current : [current], zone: "America/Phoenix" }));

describe("DownloadHero", () => {
  it("offers the Windows download first to a Windows visitor, with version, date and size, and still lists the Mac ones", () => {
    const html = render("windows", release());
    expect(html).toContain('href="/api/tracker/download/windows-x86_64"');
    expect(html).toContain("Download for Windows");
    expect(html).toContain("1.2.0");
    expect(html).toContain("Nov 20, 2026");
    expect(html).toContain("8.4 MB");
    expect(html.indexOf("Download for Windows")).toBeLessThan(html.indexOf("Download for Apple silicon"));
    expect(html).toContain('href="/api/tracker/download/darwin-aarch64"');
  });
  it("offers both Macs to a Mac visitor, and says plainly when one has no build yet", () => {
    const html = render("mac", release());
    expect(html).toContain('href="/api/tracker/download/darwin-aarch64"');
    expect(html).toContain("Download for Apple silicon");
    expect(html).toContain("Intel Mac");
    expect(html).not.toContain('href="/api/tracker/download/darwin-x86_64"'); // no Intel build: no dead link
    expect(html).toContain("Not available yet");
  });
  it("tells a phone or tablet visitor to use a work computer, and still lists the downloads", () => {
    const html = render("other", release());
    expect(html).toContain("Windows or Mac work computer");
    expect(html).toContain('href="/api/tracker/download/windows-x86_64"');
  });
  it("shows the checksum in a 'Check the file' disclosure, and never a storage path or file name", () => {
    const html = render("windows", release());
    expect(html).toContain("Check the file");
    expect(html).toContain("ab".repeat(32));
    expect(html).not.toContain("secret-path");
    expect(html).not.toContain("releases/1.2.0");
  });
  it("keeps the Windows download from the older release when the newest release is for Mac only", () => {
    const macOnly = { ...release([build("darwin-aarch64")]), id: "r2", version: "1.3.0" };
    const html = render("windows", [macOnly, release()]);
    expect(html).toContain('href="/api/tracker/download/windows-x86_64"');
    expect(html).toContain("Version 1.2.0");
    expect(html).toContain("Version 1.3.0"); // Apple silicon, from the newer Mac-only release
    expect(html).not.toMatch(/Windows<\/p><p[^>]*>Not available yet/);
    const mac = render("mac", [macOnly, release()]);
    expect(mac).toContain("Version 1.3.0");
  });
  it("says the app is not ready when there is no release", () => {
    expect(render("windows", null)).toContain("not ready to download yet");
  });
});
