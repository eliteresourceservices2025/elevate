import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { DEFAULT_TIMEZONE, SECONDARY_TIMEZONE, formatInZone } from "@/lib/time";
import { latin, wrapText } from "@/modules/privacy/pdf";
import { MAX_PDF_PAGES } from "./constants";

// Sealing: stamps every signature on an added signature page and appends a certificate page. Pure (bytes in, bytes out), so it is
// tested without a database. The original pages are copied as they are: nothing in them is edited.

const PAGE = { width: 612, height: 792, margin: 54 };
const INK = rgb(0.12, 0.1, 0.18);
const MUTED = rgb(0.42, 0.4, 0.5);
const PURPLE = rgb(0.54, 0.17, 0.89);
const LINE = rgb(0.8, 0.78, 0.86);

export type SealSigner = {
  name: string;
  email: string;
  role: string | null;
  signedAt: Date;
  ip: string | null;
  mfa: string | null;
  kind: "typed" | "drawn";
  typedText: string | null;
  png: Uint8Array | null;
  consentVersion: string;
};

export type SealEvent = { seq: number; type: string; at: Date; actor: string | null; ip: string | null };

export type SealInput = {
  original: Uint8Array;
  title: string;
  reference: string;
  originalSha256: string;
  createdBy: string;
  signers: SealSigner[];
  events: SealEvent[];
  sealedAt: Date;
};

const utc = (d: Date) => `${formatInZone(d, "UTC", "yyyy-MM-dd HH:mm:ss")} UTC`;
const manila = (d: Date) => `${formatInZone(d, SECONDARY_TIMEZONE, "MMM d, yyyy h:mm a")} Manila`;
const phoenix = (d: Date) => `${formatInZone(d, DEFAULT_TIMEZONE, "MMM d, yyyy h:mm a")} Arizona`;

/** Page count of a PDF, or throws when it cannot be read (encrypted, damaged) or is too long. */
export async function readPdfInfo(bytes: Uint8Array): Promise<{ pages: number }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const pages = doc.getPageCount();
  if (pages < 1) throw new Error("The PDF has no pages.");
  if (pages > MAX_PDF_PAGES) throw new Error(`The PDF has more than ${MAX_PDF_PAGES} pages.`);
  return { pages };
}

class Writer {
  page: PDFPage;
  y = 0;
  constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly heading: string,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.start();
  }

  private start() {
    this.page.drawRectangle({ x: 0, y: PAGE.height - 36, width: PAGE.width, height: 36, color: PURPLE });
    this.page.drawText("ELEVATE Sign", { x: PAGE.margin, y: PAGE.height - 24, size: 12, font: this.bold, color: rgb(1, 1, 1) });
    this.page.drawText(latin(this.heading), { x: PAGE.width - PAGE.margin - this.bold.widthOfTextAtSize(latin(this.heading), 10), y: PAGE.height - 23, size: 10, font: this.bold, color: rgb(1, 1, 1) });
    this.y = PAGE.height - 72;
  }

  ensure(height: number) {
    if (this.y - height < PAGE.margin) {
      this.page = this.doc.addPage([PAGE.width, PAGE.height]);
      this.start();
    }
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const indent = opts.indent ?? 0;
    for (const line of wrapText(latin(text), PAGE.width - PAGE.margin * 2 - indent, (s) => font.widthOfTextAtSize(s, size))) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: PAGE.margin + indent, y: this.y, size, font, color: opts.color ?? INK });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 0;
  }

  rule() {
    this.ensure(10);
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: PAGE.width - PAGE.margin, y: this.y }, thickness: 0.5, color: LINE });
    this.y -= 10;
  }
}

/**
 * Returns the sealed PDF: the original pages, then a signature page (one box per signer, in signing order) and a certificate
 * (document, signers with times in UTC, Manila and Arizona, IP addresses, how they signed in, and the event log).
 */
export async function sealPdf(input: SealInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.original, { updateMetadata: false });
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const script = await doc.embedFont(StandardFonts.TimesRomanItalic);

  // ---- Signature page -------------------------------------------------------------------------------------------------
  const sig = new Writer(doc, regular, bold, `${input.reference}`);
  sig.text("Signatures", { size: 20, bold: true, gap: 2 });
  sig.text(`${input.title}`, { size: 11, color: MUTED });
  sig.text("Each person below signed this document electronically in ELEVATE. The certificate that follows records how.", { size: 9, color: MUTED, gap: 10 });

  for (const s of input.signers) {
    sig.ensure(120);
    const top = sig.y;
    sig.page.drawRectangle({ x: PAGE.margin, y: top - 100, width: PAGE.width - PAGE.margin * 2, height: 100, borderColor: LINE, borderWidth: 0.8 });
    // The signature itself
    if (s.kind === "drawn" && s.png) {
      let image: PDFImage | null = null;
      try {
        image = await doc.embedPng(s.png);
      } catch {
        image = null; // a corrupt image falls back to the typed name below
      }
      if (image) {
        const scale = Math.min(200 / image.width, 56 / image.height, 1);
        sig.page.drawImage(image, { x: PAGE.margin + 14, y: top - 14 - image.height * scale - 6, width: image.width * scale, height: image.height * scale });
      }
    } else {
      sig.page.drawText(latin(s.typedText ?? s.name).slice(0, 40), { x: PAGE.margin + 14, y: top - 48, size: 26, font: script, color: INK });
    }
    sig.page.drawLine({ start: { x: PAGE.margin + 14, y: top - 66 }, end: { x: PAGE.margin + 260, y: top - 66 }, thickness: 0.6, color: MUTED });
    sig.page.drawText(latin(`${s.name}${s.role ? `, ${s.role}` : ""}`), { x: PAGE.margin + 14, y: top - 80, size: 10, font: bold, color: INK });
    sig.page.drawText(latin(s.email), { x: PAGE.margin + 14, y: top - 93, size: 8.5, font: regular, color: MUTED });
    sig.page.drawText("Signed electronically", { x: PAGE.margin + 290, y: top - 30, size: 9, font: bold, color: PURPLE });
    sig.page.drawText(utc(s.signedAt), { x: PAGE.margin + 290, y: top - 45, size: 9, font: regular, color: INK });
    sig.page.drawText(manila(s.signedAt), { x: PAGE.margin + 290, y: top - 58, size: 9, font: regular, color: MUTED });
    sig.page.drawText(phoenix(s.signedAt), { x: PAGE.margin + 290, y: top - 71, size: 9, font: regular, color: MUTED });
    sig.y = top - 116;
  }

  // ---- Certificate ----------------------------------------------------------------------------------------------------
  const cert = new Writer(doc, regular, bold, `${input.reference}`);
  cert.text("Certificate of completion", { size: 20, bold: true, gap: 4 });
  cert.text(`Document: ${input.title}`, { bold: true });
  cert.text(`Reference: ${input.reference}`);
  cert.text(`Created by: ${input.createdBy}`);
  cert.text(`Sealed: ${utc(input.sealedAt)}`);
  cert.text(`SHA-256 of the original document: ${input.originalSha256}`, { size: 8.5 });
  cert.text("The SHA-256 of this sealed file is recorded in ELEVATE (a file cannot contain its own fingerprint). To check a copy, use Verify document in ELEVATE.", { size: 8.5, color: MUTED, gap: 8 });
  cert.rule();

  cert.text("Signers", { size: 13, bold: true, gap: 2 });
  for (const s of input.signers) {
    cert.ensure(70);
    cert.text(`${s.name}${s.role ? ` (${s.role})` : ""}`, { bold: true });
    cert.text(s.email, { indent: 10, color: MUTED });
    cert.text(`Signed ${utc(s.signedAt)} | ${manila(s.signedAt)}`, { indent: 10 });
    cert.text(`IP address ${s.ip ?? "not recorded"} | Signed in with ${s.mfa ?? "MFA (method not recorded)"} | ${s.kind === "drawn" ? "Drew" : "Typed"} signature`, { indent: 10 });
    cert.text(`Agreed to sign electronically (consent wording version ${s.consentVersion})`, { indent: 10, gap: 6 });
  }
  cert.rule();

  cert.text("Event log", { size: 13, bold: true, gap: 2 });
  for (const e of input.events) {
    cert.text(`${String(e.seq).padStart(2, "0")}  ${utc(e.at)}  ${e.type}${e.actor ? `  by ${e.actor}` : ""}${e.ip ? `  from ${e.ip}` : ""}`, { size: 8.5 });
  }
  cert.text("Each event is chained to the one before it with a SHA-256 hash, so a removed or changed event can be detected.", { size: 8.5, color: MUTED });

  doc.setTitle(latin(input.title));
  doc.setProducer("ELEVATE Sign");
  doc.setCreator("ELEVATE Sign");
  doc.setModificationDate(input.sealedAt);
  return doc.save({ useObjectStreams: false });
}
