import { describe, expect, it } from "vitest";
import { ALLOWED_MIME_TYPES, FILE_TYPES, formatBytes, kindFromMime, sanitizeFileName, sniffFileKind } from "./files";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

describe("sniffFileKind (by bytes, not by name)", () => {
  it("recognises PDF, JPEG and PNG by their signatures", () => {
    expect(sniffFileKind(new Uint8Array([...ascii("%PDF-1.7\n"), 1, 2, 3]))).toBe("pdf");
    expect(sniffFileKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpg");
    expect(sniffFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
  });

  it("accepts a ZIP only if it is a Word document", () => {
    const zip = (...names: string[]) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...names.flatMap((n) => [0, ...ascii(n)])]);
    expect(sniffFileKind(zip("[Content_Types].xml", "word/document.xml"))).toBe("docx");
    expect(sniffFileKind(zip("[Content_Types].xml", "xl/workbook.xml"))).toBeNull(); // spreadsheet
    expect(sniffFileKind(zip("[Content_Types].xml", "ppt/presentation.xml"))).toBeNull(); // presentation
    expect(sniffFileKind(zip("readme.txt"))).toBeNull(); // plain zip
  });

  it("rejects executables, scripts, HTML, SVG and tiny or empty files", () => {
    expect(sniffFileKind(new Uint8Array([...ascii("MZ"), 0x90, 0, 3, 0, 0, 0, 4, 0]))).toBeNull(); // Windows program
    expect(sniffFileKind(new Uint8Array(ascii("<html><script>alert(1)</script>")))).toBeNull();
    expect(sniffFileKind(new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))).toBeNull();
    expect(sniffFileKind(new Uint8Array(ascii("#!/bin/sh\nrm -rf /")))).toBeNull();
    expect(sniffFileKind(new Uint8Array([0x25, 0x50]))).toBeNull();
    expect(sniffFileKind(new Uint8Array())).toBeNull();
  });

  it("a renamed file is judged by content: an EXE named .pdf is still refused", () => {
    expect(sniffFileKind(new Uint8Array([...ascii("MZ"), 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe("mime allowlist", () => {
  it("has exactly PDF, JPG, PNG and DOCX", () => {
    expect(ALLOWED_MIME_TYPES.sort()).toEqual(Object.values(FILE_TYPES).map((t) => t.mime).sort());
    expect(ALLOWED_MIME_TYPES).toHaveLength(4);
  });
  it("maps a declared type to a kind", () => {
    expect(kindFromMime("application/pdf")).toBe("pdf");
    expect(kindFromMime("IMAGE/PNG")).toBe("png");
    for (const bad of ["text/html", "image/svg+xml", "application/zip", "application/x-msdownload", ""]) expect(kindFromMime(bad)).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  it("drops paths, control characters and the claimed extension", () => {
    expect(sanitizeFileName("../../etc/passwd", "pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName("C:\\Users\\me\\NBI clearance.exe", "pdf")).toBe("NBI clearance.pdf");
    expect(sanitizeFileName("bad\u0000name\n<script>.png", "jpg")).toBe("badnamescript.jpg");
    expect(sanitizeFileName("   ", "docx")).toBe("document.docx");
    expect(sanitizeFileName("", "png")).toBe("document.png");
  });
  it("bounds the length", () => {
    expect(sanitizeFileName("a".repeat(500) + ".pdf", "pdf").length).toBeLessThanOrEqual(104);
  });
});

describe("formatBytes", () => {
  it("is readable", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
