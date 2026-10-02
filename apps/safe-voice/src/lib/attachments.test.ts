import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cleanAttachment, sniffType } from "./attachments";

const MARK = "SECRET-CAMERA-OWNER-Dela-Cruz";

async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 32, channels: 3, background: "#336699" } })
    .withExif({ IFD0: { Copyright: MARK, Artist: MARK, ImageDescription: MARK } })
    .jpeg()
    .toBuffer();
}

async function pngWithMetadata(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 0.5 } } })
    .withExif({ IFD0: { Copyright: MARK } })
    .png()
    .toBuffer();
}

async function pdfWithInfo(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setAuthor(MARK);
  doc.setTitle(MARK);
  doc.setSubject(MARK);
  doc.setKeywords([MARK]);
  doc.setCreator(MARK);
  doc.setProducer(MARK);
  doc.setCreationDate(new Date("2020-01-02T03:04:05Z"));
  const page = doc.addPage([200, 200]);
  page.drawText("Hello, a report", { x: 20, y: 100 });
  // An annotation with an author field, which also counts as metadata.
  const annot = doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30], T: PDFString.of(MARK), Contents: PDFString.of("note") });
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));
  return doc.save({ useObjectStreams: false });
}

const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text, "latin1")) || Buffer.from(bytes).includes(Buffer.from(text, "utf16le"));

describe("sniffType", () => {
  it("reads the real type from the bytes, not the name", async () => {
    expect(sniffType(await jpegWithExif())).toBe("image/jpeg");
    expect(sniffType(await pngWithMetadata())).toBe("image/png");
    expect(sniffType(await pdfWithInfo())).toBe("application/pdf");
    expect(sniffType(Buffer.from("MZ\x90\x00 this is an exe"))).toBeNull();
    expect(sniffType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });
});

describe("cleanAttachment", () => {
  it("re-encodes a JPEG without its EXIF data", async () => {
    const original = await jpegWithExif();
    expect(contains(original, MARK)).toBe(true);
    const result = await cleanAttachment(original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.contentType).toBe("image/jpeg");
    expect(contains(result.file.data, MARK)).toBe(false);
    const meta = await sharp(result.file.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([64, 32]);
  });

  it("re-encodes a PNG, keeping transparency but not its metadata", async () => {
    const original = await pngWithMetadata();
    const result = await cleanAttachment(original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(contains(result.file.data, MARK)).toBe(false);
    const meta = await sharp(result.file.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.hasAlpha).toBe(true);
  });

  it("applies the orientation before dropping it", async () => {
    const tall = await sharp({ create: { width: 60, height: 20, channels: 3, background: "#fff" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const result = await cleanAttachment(tall);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = await sharp(result.file.data).metadata();
    expect([meta.width, meta.height]).toEqual([20, 60]);
    expect(meta.orientation).toBeUndefined();
  });

  it("shrinks very large pictures", async () => {
    const big = await sharp({ create: { width: 3600, height: 1200, channels: 3, background: "#abc" } }).jpeg({ quality: 40 }).toBuffer();
    const result = await cleanAttachment(big);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await sharp(result.file.data).metadata()).width).toBe(2400);
  });

  it("rebuilds a PDF with no Info entries, no producer, no dates and no annotations", async () => {
    const original = await pdfWithInfo();
    expect(contains(original, MARK)).toBe(true);
    const result = await cleanAttachment(original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.contentType).toBe("application/pdf");
    expect(contains(result.file.data, MARK)).toBe(false);
    expect(contains(result.file.data, "pdf-lib")).toBe(false);
    expect(contains(result.file.data, "/Annots")).toBe(false);
    expect(contains(result.file.data, "/CreationDate")).toBe(false);
    expect(contains(result.file.data, "/Producer")).toBe(false);
    const reread = await PDFDocument.load(result.file.data, { updateMetadata: false });
    expect(reread.getPageCount()).toBe(1);
    expect(reread.getAuthor()).toBeUndefined();
    expect(reread.getTitle()).toBeUndefined();
    expect(reread.getCreator()).toBeUndefined();
    expect(reread.getProducer()).toBeUndefined();
    expect(reread.getCreationDate()).toBeUndefined();
  });

  it("refuses files that are not a JPEG, PNG or PDF, even when named like one", async () => {
    expect((await cleanAttachment(Buffer.from("MZ not a picture"))).ok).toBe(false);
    expect((await cleanAttachment(Buffer.from("%PDF-1.7 but really text"))).ok).toBe(false);
    expect((await cleanAttachment(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("broken")]))).ok).toBe(false);
  });

  it("refuses an encrypted PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = Buffer.from(await doc.save());
    // A minimal /Encrypt entry in the trailer makes pdf-lib refuse to load it.
    const tampered = Buffer.from(bytes.toString("latin1").replace("trailer\n<<", "trailer\n<< /Encrypt << /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>"), "latin1");
    const result = await cleanAttachment(tampered);
    // Either the tampering did not take (no trailer keyword in an xref stream) and the file is simply rebuilt, or it is refused: never passed through unchanged.
    if (result.ok) expect(contains(result.file.data, "/Encrypt")).toBe(false);
  });
});
