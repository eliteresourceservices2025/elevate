// The person's own training record as one PDF (Release 3): every assignment with its status, dates, time, tries, their own passing
// score and certificate reference. It is theirs: it is built from rows read through their own session. Learn only (unlike the
// certificate, ELEVATE has its own My data export). Pure text with pdf-lib, paged.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { RecordEntry } from "./queries";

const TRACK: Record<string, string> = { full: "Full course", essentials: "Essentials", refresher: "Refresher" };
const STATUS: Record<string, string> = { assigned: "Not started", in_progress: "In progress", passed: "Passed", expired: "Expired", cancelled: "Cancelled" };

const PAGE = { w: 595.28, h: 841.89, margin: 48 };

/** Wraps text to a width with the given font. Words longer than the line are broken. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Characters the standard PDF font cannot draw are replaced (names can carry accents; WinAnsi covers the common ones). */
const safe = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, "?");

export async function renderRecordPdf(input: { holderName: string; generatedOn: string; entries: RecordEntry[] }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("My training record");
  doc.setProducer("ELEVATE Learn");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.4, 0.4, 0.45);
  const width = PAGE.w - PAGE.margin * 2;

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  const room = (needed: number) => {
    if (y - needed < PAGE.margin) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - PAGE.margin;
    }
  };
  const write = (text: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    for (const l of wrap(safe(text), font, size, width - (opts.indent ?? 0))) {
      room(size + 4);
      page.drawText(l, { x: PAGE.margin + (opts.indent ?? 0), y: y - size, size, font, color: opts.color ?? ink });
      y -= size + 4;
    }
    y -= opts.gap ?? 0;
  };

  write("ELEVATE Learn", { font: bold, size: 11, color: muted });
  write("My training record", { font: bold, size: 22, gap: 4 });
  write(`${input.holderName}`, { size: 12 });
  write(`Prepared ${input.generatedOn}. This lists your own training; your scores are shown to you, HR and the privacy team only.`, { color: muted, size: 9, gap: 10 });

  if (input.entries.length === 0) write("You have no training on record yet.");
  for (const e of input.entries) {
    room(70);
    write(`${e.courseTitle}`, { font: bold, size: 12 });
    write(`${TRACK[e.track] ?? e.track} · ${STATUS[e.status] ?? e.status}`, { color: muted });
    write(`Assigned ${e.assignedOn} · due ${e.dueOn}${e.passedOn ? ` · passed ${e.passedOn}` : ""}`, { indent: 10 });
    write(`About ${e.minutesSpent} minutes reading · ${e.attempts} exam ${e.attempts === 1 ? "try" : "tries"}${e.scorePercent !== null ? ` · passing score ${e.scorePercent}%` : ""}`, { indent: 10 });
    if (e.certificate) {
      write(`Certificate ${e.certificate.reference}: issued ${e.certificate.issuedOn}, valid until ${e.certificate.endsOn}${e.certificate.revoked ? " (revoked)" : ""}`, { indent: 10 });
    }
    y -= 8;
  }
  return doc.save();
}
