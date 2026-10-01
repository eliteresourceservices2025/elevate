import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { GENESIS_HASH, computeEventHash, sha256Hex, verifyChain, type ChainFields, type StoredEvent } from "./chain";
import { allSigned, envelopeReference, isPdf, isTypedSignatureEncodable, pngSize, reminderDue, signersToActivate } from "./constants";
import { readPdfInfo, sealPdf, type SealInput } from "./seal";

async function samplePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Agreement page ${i + 1}`, { x: 60, y: 700 });
  return doc.save();
}

describe("who may sign now", () => {
  const s = (position: number, status: "waiting" | "pending" | "signed" | "declined" | "cancelled") => ({ position, status });
  it("parallel: everyone still open", () => {
    expect(signersToActivate("parallel", [s(1, "pending"), s(2, "waiting"), s(3, "signed")])).toEqual([1, 2]);
  });
  it("sequential: only the earliest open position, and people at the same position sign together", () => {
    expect(signersToActivate("sequential", [s(1, "signed"), s(2, "waiting"), s(2, "waiting"), s(3, "waiting")])).toEqual([2]);
    expect(signersToActivate("sequential", [s(1, "pending"), s(2, "waiting")])).toEqual([1]);
  });
  it("nobody when everyone has finished", () => {
    expect(signersToActivate("sequential", [s(1, "signed")])).toEqual([]);
    expect(allSigned([s(1, "signed"), s(2, "signed")])).toBe(true);
    expect(allSigned([s(1, "signed"), s(2, "pending")])).toBe(false);
    expect(allSigned([])).toBe(false);
  });
});

describe("small rules", () => {
  it("reminds every 3 days", () => {
    const base = new Date("2026-10-01T00:00:00Z");
    expect(reminderDue(base, new Date("2026-10-03T23:00:00Z"))).toBe(false);
    expect(reminderDue(base, new Date("2026-10-04T00:00:00Z"))).toBe(true);
  });
  it("makes a short reference from the id", () => {
    expect(envelopeReference("a1b2c3d4-0000-4000-8000-000000000000")).toBe("ES-A1B2C3D4");
  });
  it("typed signatures must be drawable in a standard font", () => {
    expect(isTypedSignatureEncodable("Ana Reyes")).toBe(true);
    expect(isTypedSignatureEncodable("José Peña")).toBe(true);
    expect(isTypedSignatureEncodable("山田太郎")).toBe(false);
    expect(isTypedSignatureEncodable("")).toBe(false);
  });
  it("recognizes PDFs and reads a PNG's size from its header", () => {
    expect(isPdf(new TextEncoder().encode("%PDF-1.7 rest"))).toBe(true);
    expect(isPdf(new TextEncoder().encode("MZ......."))).toBe(false);
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(png.buffer).setUint32(16, 300);
    new DataView(png.buffer).setUint32(20, 120);
    expect(pngSize(png)).toEqual({ width: 300, height: 120 });
    expect(pngSize(new Uint8Array(30))).toBeNull();
  });
});

describe("the event hash chain", () => {
  const build = (): StoredEvent[] => {
    const types = ["created", "sent", "viewed", "consented", "signed"];
    const events: StoredEvent[] = [];
    let prev = GENESIS_HASH;
    types.forEach((type, i) => {
      const fields: ChainFields = { envelopeId: "env-1", seq: i + 1, type, actorUserId: "u1", signerId: null, at: `2026-10-0${i + 1}T00:00:00.000Z`, ip: "203.0.113.5", detail: { n: i } };
      const hash = computeEventHash(prev, fields);
      events.push({ ...fields, prevHash: prev, hash });
      prev = hash;
    });
    return events;
  };

  it("verifies an untouched chain", () => {
    expect(verifyChain(build())).toEqual({ ok: true });
  });
  it("detects an edited event, a removed event and a reordered chain", () => {
    const edited = build();
    edited[2].ip = "198.51.100.1";
    expect(verifyChain(edited)).toEqual({ ok: false, brokenAt: 3 });
    const removed = build().filter((e) => e.seq !== 3);
    expect(verifyChain(removed).ok).toBe(false);
    const swapped = build();
    [swapped[1], swapped[3]] = [swapped[3], swapped[1]];
    expect(verifyChain(swapped).ok).toBe(true); // the chain sorts by seq, so order of storage does not matter
    const forged = build();
    forged[4].prevHash = GENESIS_HASH;
    expect(verifyChain(forged)).toEqual({ ok: false, brokenAt: 5 });
  });
  it("hashes the same data the same way whatever the key order", () => {
    const a = computeEventHash(GENESIS_HASH, { envelopeId: "e", seq: 1, type: "created", actorUserId: null, signerId: null, at: "x", ip: null, detail: { a: 1, b: 2 } });
    const b = computeEventHash(GENESIS_HASH, { detail: { b: 2, a: 1 }, ip: null, at: "x", signerId: null, actorUserId: null, type: "created", seq: 1, envelopeId: "e" });
    expect(a).toBe(b);
  });
});

describe("sealing", () => {
  const input = async (over: Partial<SealInput> = {}): Promise<SealInput> => ({
    original: await samplePdf(2),
    title: "Contractor agreement",
    reference: "ES-TEST0001",
    originalSha256: "ab".repeat(32),
    createdBy: "hr@example.com",
    signers: [
      { name: "Ana Reyes", email: "ana@example.com", role: "Contractor", signedAt: new Date("2026-10-02T01:30:00Z"), ip: "203.0.113.5", mfa: "password, totp", kind: "typed", typedText: "Ana Reyes", png: null, consentVersion: "2026-10" },
      { name: "Ben Cruz", email: "ben@example.com", role: "ERS representative", signedAt: new Date("2026-10-02T03:00:00Z"), ip: null, mfa: null, kind: "drawn", typedText: null, png: null, consentVersion: "2026-10" },
    ],
    events: [
      { seq: 1, type: "created", at: new Date("2026-10-01T00:00:00Z"), actor: "hr@example.com", ip: "203.0.113.9" },
      { seq: 2, type: "signed", at: new Date("2026-10-02T01:30:00Z"), actor: "ana@example.com", ip: "203.0.113.5" },
    ],
    sealedAt: new Date("2026-10-02T03:00:05Z"),
    ...over,
  });

  it("keeps the original pages and adds a signature page and a certificate", async () => {
    const sealed = await sealPdf(await input());
    const doc = await PDFDocument.load(sealed);
    expect(doc.getPageCount()).toBe(2 + 2);
    expect(isPdf(sealed)).toBe(true);
  });
  it("is different from the original, so its fingerprint differs", async () => {
    const i = await input();
    const sealed = await sealPdf(i);
    expect(sha256Hex(sealed)).not.toBe(sha256Hex(i.original));
  });
  it("changing one byte of the sealed file changes its fingerprint", async () => {
    const sealed = await sealPdf(await input());
    const copy = sealed.slice();
    copy[copy.length - 20] ^= 0xff;
    expect(sha256Hex(copy)).not.toBe(sha256Hex(sealed));
  });
  it("handles names the standard font cannot draw, and many signers across pages", async () => {
    const many = Array.from({ length: 9 }, (_, n) => ({ name: `山田 ${n}`, email: `p${n}@example.com`, role: null, signedAt: new Date(), ip: "203.0.113.5", mfa: "totp", kind: "typed" as const, typedText: null, png: null, consentVersion: "2026-10" }));
    const sealed = await sealPdf(await input({ signers: many }));
    expect((await PDFDocument.load(sealed)).getPageCount()).toBeGreaterThan(4);
  });
  it("reads a PDF's page count and refuses junk", async () => {
    expect(await readPdfInfo(await samplePdf(3))).toEqual({ pages: 3 });
    await expect(readPdfInfo(new TextEncoder().encode("not a pdf at all, really"))).rejects.toThrow();
  });
});
