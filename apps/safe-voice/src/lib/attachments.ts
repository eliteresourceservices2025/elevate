import { PDFDocument, PDFName } from "pdf-lib";
import sharp from "sharp";
import { LIMITS } from "./constants";

// Attachments are checked by their bytes (never the file name or the declared type), then REBUILT so no metadata survives:
//  - pictures are decoded and encoded again (EXIF, GPS, camera, ICC, XMP and text chunks do not carry over; the orientation is applied
//    first so the picture still looks right), at most 2400 pixels on a side;
//  - PDFs are copied page by page into a new document with no Info dictionary, no XMP, no annotations (their author fields), no
//    page-level metadata and no producer or dates.
// Not covered: text written on the page itself, and metadata inside pictures that are embedded in a PDF. The page tells people so.
// Neither the original file name nor any time is kept; the file is stored as bytes with a type and a size.

export type CleanFile = { contentType: "image/jpeg" | "image/png" | "application/pdf"; data: Buffer };
export type CleanResult = { ok: true; file: CleanFile } | { ok: false };

export function sniffType(bytes: Uint8Array): CleanFile["contentType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // eslint-disable-next-line security/detect-object-injection -- `i` is a loop index over a fixed 8-byte signature
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  // The PDF header may follow a few bytes of junk; allow the first 1 KB as the spec does.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "application/pdf";
  return null;
}

async function cleanImage(bytes: Uint8Array, type: "image/jpeg" | "image/png"): Promise<CleanFile> {
  const pipeline = sharp(Buffer.from(bytes), { limitInputPixels: LIMITS.maxImagePixels, failOn: "error" })
    .rotate() // apply the EXIF orientation, then forget it
    .resize({ width: LIMITS.maxImageEdge, height: LIMITS.maxImageEdge, fit: "inside", withoutEnlargement: true });
  // No withMetadata(): sharp drops every metadata block from the output.
  const data = type === "image/jpeg" ? await pipeline.jpeg({ quality: 85 }).toBuffer() : await pipeline.png({ compressionLevel: 9 }).toBuffer();
  return { contentType: type, data };
}

async function cleanPdf(bytes: Uint8Array): Promise<CleanFile> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false }); // encrypted files throw here
  const count = source.getPageCount();
  if (count < 1 || count > LIMITS.maxPdfPages) throw new Error("page count");
  // Strip the page-level extras from the SOURCE pages first: copying brings every referenced object along, so removing them from the
  // copy would leave the annotation (and its author) behind as an unused object in the new file.
  for (const page of source.getPages()) for (const key of ["Annots", "Metadata", "PieceInfo", "Thumb", "AA", "B", "LastModified"]) page.node.delete(PDFName.of(key));
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const page of await out.copyPages(source, source.getPageIndices())) out.addPage(page);
  const data = Buffer.from(await out.save({ useObjectStreams: false }));
  return { contentType: "application/pdf", data };
}

/** Sizes are checked by the caller before this runs; here the file must be one of the three types and survive being rebuilt. */
export async function cleanAttachment(bytes: Uint8Array): Promise<CleanResult> {
  const type = sniffType(bytes);
  if (!type) return { ok: false };
  try {
    return { ok: true, file: type === "application/pdf" ? await cleanPdf(bytes) : await cleanImage(bytes, type) };
  } catch {
    return { ok: false }; // damaged, encrypted, too large in pixels, or not really what it says: refused without saying which
  }
}
