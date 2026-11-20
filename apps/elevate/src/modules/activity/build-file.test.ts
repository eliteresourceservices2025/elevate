import { describe, expect, it } from "vitest";
import { buildStoragePath, checkBuildFile, parseBuildArgs } from "./build-file";

const MZ = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const GZIP = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const ANY = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const MB = 1024 * 1024;

describe("parseBuildArgs", () => {
  const ok = ["--version", "1.2.0", "--platform", "windows-x86_64", "--kind", "installer", "--file", "app.exe"];
  it("reads the flags", () => {
    expect(parseBuildArgs(ok)).toEqual({ ok: true, args: { version: "1.2.0", platform: "windows-x86_64", kind: "installer", file: "app.exe", sig: undefined } });
  });
  it("refuses a missing flag, a bad platform, a bad version and an unknown flag", () => {
    expect(parseBuildArgs(ok.slice(2)).ok).toBe(false);
    expect(parseBuildArgs(["--version", "1.2.0", "--platform", "linux-x86_64", "--kind", "installer", "--file", "a"]).ok).toBe(false);
    expect(parseBuildArgs(["--version", "1.2", "--platform", "windows-x86_64", "--kind", "installer", "--file", "a"]).ok).toBe(false);
    expect(parseBuildArgs([...ok, "--wat", "x"]).ok).toBe(false);
  });
  it("needs --sig for an update build, and takes it", () => {
    const update = ["--version", "1.2.0", "--platform", "windows-x86_64", "--kind", "update", "--file", "app.exe"];
    expect(parseBuildArgs(update).ok).toBe(false);
    expect(parseBuildArgs([...update, "--sig", "app.exe.sig"])).toMatchObject({ ok: true, args: { sig: "app.exe.sig" } });
  });
});

describe("buildStoragePath", () => {
  it("keeps the layout and makes the file name safe", () => {
    expect(buildStoragePath("1.2.0", "windows-x86_64", "installer", "ELEVATE Tracker_1.2.0 x64.msi")).toBe("releases/1.2.0/windows-x86_64/installer/ELEVATE-Tracker_1.2.0-x64.msi");
    const evil = buildStoragePath("1.2.0", "windows-x86_64", "installer", "../../etc/passwd");
    expect(evil.startsWith("releases/1.2.0/windows-x86_64/installer/")).toBe(true);
    expect(evil.slice("releases/1.2.0/windows-x86_64/installer/".length)).not.toContain("/");
    expect(evil).not.toContain("..");
  });
});

describe("checkBuildFile", () => {
  const base = { platform: "windows-x86_64" as const, kind: "installer" as const, sizeBytes: 8 * MB };
  it("accepts a Windows .exe with the MZ header and a .msi with the OLE header", () => {
    expect(checkBuildFile({ ...base, fileName: "app.exe", head: MZ }).ok).toBe(true);
    expect(checkBuildFile({ ...base, fileName: "app.msi", head: OLE }).ok).toBe(true);
  });
  it("refuses a name that does not match the bytes", () => {
    expect(checkBuildFile({ ...base, fileName: "app.exe", head: PDF }).ok).toBe(false);
    expect(checkBuildFile({ ...base, fileName: "app.msi", head: MZ }).ok).toBe(false);
  });
  it("refuses a file that is far too small or too large", () => {
    expect(checkBuildFile({ ...base, sizeBytes: 10, fileName: "app.exe", head: MZ }).ok).toBe(false);
    expect(checkBuildFile({ ...base, sizeBytes: 151 * MB, fileName: "app.exe", head: MZ }).ok).toBe(false);
  });
  it("accepts a .dmg for a Mac and refuses it for Windows", () => {
    expect(checkBuildFile({ platform: "darwin-aarch64", kind: "installer", sizeBytes: 9 * MB, fileName: "app.dmg", head: ANY }).ok).toBe(true);
    expect(checkBuildFile({ ...base, fileName: "app.dmg", head: ANY }).ok).toBe(false);
  });
  it("refuses a Mac installer that is not a .dmg", () => {
    expect(checkBuildFile({ platform: "darwin-x86_64", kind: "installer", sizeBytes: 9 * MB, fileName: "app.exe", head: MZ }).ok).toBe(false);
  });
  it("accepts a gzip update only with the gzip header, and a Windows update as .exe or .msi", () => {
    expect(checkBuildFile({ platform: "darwin-aarch64", kind: "update", sizeBytes: 9 * MB, fileName: "app.app.tar.gz", head: GZIP }).ok).toBe(true);
    expect(checkBuildFile({ platform: "darwin-aarch64", kind: "update", sizeBytes: 9 * MB, fileName: "app.app.tar.gz", head: ANY }).ok).toBe(false);
    expect(checkBuildFile({ ...base, kind: "update", fileName: "app.exe", head: MZ }).ok).toBe(true);
  });
});
