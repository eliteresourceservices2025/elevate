// The certificate of completion and its transcript as a PDF. This file is kept IDENTICAL in two places (a test in ELEVATE compares them):
//   apps/learn/src/lib/certificate-pdf.ts                 (the download button on the certificate page)
//   apps/elevate/src/modules/learn/certificate-pdf.ts     (the copy emailed when the certificate is recorded)
// It imports only pdf-lib and the logo file next to it, so it can be shared this way. Change both together.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { CERTIFICATE_LOGO_PNG_BASE64 } from "./certificate-logo";

export type CertificateModule = { title: string; completedOn: string | null };

export type CertificateInput = {
  holderName: string;
  courseTitle: string;
  /** ISO dates, YYYY-MM-DD. */
  issuedOn: string;
  endsOn: string;
  reference: string;
  /** Where anyone can check the certificate (shown as text, not a link to anything personal). */
  verifyUrl: string;
  /** The company named on the transcript. */
  organization?: string;
  /** The modules of the person's track, in order, with the day each was finished. */
  modules?: CertificateModule[];
  /** The passing exam: score in percent and the day it was taken. */
  scorePercent?: number | null;
  takenOn?: string | null;
  /** The address the person's acceptance came from (as recorded when they accepted). */
  ipAddress?: string | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-13" -> "13 October 2026". Anything that is not an ISO date is returned as it came. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

/** The standard PDF fonts only draw Latin-1 text; anything else becomes "?" (same rule as the other ELEVATE PDFs). */
function safe(text: string): string {
  return Array.from(text.normalize("NFC"))
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 63;
      return code >= 32 && code <= 126 ? ch : code >= 160 && code <= 255 ? ch : "?";
    })
    .join("");
}

function fit(font: PDFFont, text: string, max: number, start: number, min: number): number {
  let size = start;
  while (size > min && font.widthOfTextAtSize(text, size) > max) size -= 1;
  return size;
}

/** Breaks text into lines no wider than `max` at the given size (words only; a very long word is cut). */
function wrap(font: PDFFont, text: string, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= max) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > max && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > max) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

const purple = rgb(0x6c / 255, 0x1a / 255, 0xba / 255);
const gold = rgb(0xe2 / 255, 0xbe / 255, 0x2b / 255);
const ink = rgb(0.13, 0.13, 0.17);
const grey = rgb(0.4, 0.4, 0.45);

export async function renderCertificatePdf(input: CertificateInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Certificate of Completion");
  pdf.setAuthor("Elite Resource Services");
  pdf.setCreator("ELEVATE Learn");
  pdf.setProducer("ELEVATE Learn");

  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const logo = await pdf.embedPng(Buffer.from(CERTIFICATE_LOGO_PNG_BASE64, "base64"));
  const organization = input.organization ?? "Elite Resource Services";

  // ---- Page 1: the certificate (A4 landscape) -----------------------------------------------------------------------------
  const W = 842;
  const H = 595;
  const page = pdf.addPage([W, H]);

  // A large, faded copy of the logo behind everything, centered.
  const bg = Math.min(380 / logo.width, 380 / logo.height);
  page.drawImage(logo, { x: (W - logo.width * bg) / 2, y: (H - logo.height * bg) / 2 - 10, width: logo.width * bg, height: logo.height * bg, opacity: 0.08 });

  // Frame: a purple border and a thin gold line inside it.
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: purple, borderWidth: 4 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: gold, borderWidth: 1 });

  const center = (p: PDFPage, text: string, y: number, font: PDFFont, size: number, color = ink, width = W) => {
    const t = safe(text);
    p.drawText(t, { x: (width - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
  };
  const fitted = (text: string, y: number, font: PDFFont, start: number, min: number, color = ink) => {
    const t = safe(text);
    center(page, t, y, font, fit(font, t, W - 160, start, min), color);
  };

  const lw = 56;
  const lh = (logo.height / logo.width) * lw;
  page.drawImage(logo, { x: (W - lw) / 2, y: H - 52 - lh, width: lw, height: lh });
  center(page, "ELITE RESOURCE SERVICES", H - 76 - lh + 8, bold, 11, purple);
  center(page, "Certificate of Completion", H - 168, serif, 38, ink);
  page.drawRectangle({ x: W / 2 - 60, y: H - 182, width: 120, height: 3, color: gold });

  center(page, "This certifies that", H - 212, sans, 13, grey);
  fitted(input.holderName, H - 254, serif, 34, 16, purple);
  center(page, "has completed the training", H - 282, sans, 13, grey);
  fitted(input.courseTitle, H - 314, bold, 22, 12, ink);
  center(page, `for ${organization}.`, H - 338, sans, 13, grey);

  const covered = (input.modules ?? []).map((m) => m.title).filter(Boolean);
  let y = H - 372;
  if (covered.length > 0) {
    center(page, "This course covered:", y, bold, 11, ink);
    y -= 15;
    const lines = wrap(sans, covered.join("  |  "), 10, W - 220).slice(0, 4);
    for (const line of lines) {
      center(page, line, y, sans, 10, grey);
      y -= 13;
    }
    y -= 6;
  }

  center(page, `Issued ${longDate(input.issuedOn)}   |   Valid until ${longDate(input.endsOn)}`, Math.max(y - 12, 126), bold, 12, ink);
  center(page, `Reference ${input.reference}`, Math.max(y - 32, 106), sans, 11, grey);

  center(page, "This is ERS training completion, not an official certification issued by any government body.", 80, sans, 9, grey);
  fitted(`To check this certificate, enter the reference and the full name at ${input.verifyUrl}`, 64, sans, 9, 6, grey);

  // ---- Page 2: the transcript (A4 portrait) -------------------------------------------------------------------------------
  const PW = 595;
  const PH = 842;
  const t = pdf.addPage([PW, PH]);
  const tbg = Math.min(360 / logo.width, 360 / logo.height);
  t.drawImage(logo, { x: (PW - logo.width * tbg) / 2, y: (PH - logo.height * tbg) / 2, width: logo.width * tbg, height: logo.height * tbg, opacity: 0.06 });
  t.drawRectangle({ x: 24, y: 24, width: PW - 48, height: PH - 48, borderColor: purple, borderWidth: 2 });

  const tl = 40;
  t.drawImage(logo, { x: 48, y: PH - 56 - (logo.height / logo.width) * tl, width: tl, height: (logo.height / logo.width) * tl });
  t.drawText("Training transcript", { x: 100, y: PH - 82, size: 22, font: serif, color: ink });
  t.drawText(safe(organization), { x: 100, y: PH - 98, size: 10, font: sans, color: purple });
  t.drawRectangle({ x: 48, y: PH - 116, width: PW - 96, height: 2, color: gold });

  const facts: [string, string][] = [
    ["Name", input.holderName],
    ["Organization", organization],
    ["Course", input.courseTitle],
    ["Date taken", input.takenOn ? longDate(input.takenOn) : "Not recorded"],
    ["Score", input.scorePercent === null || input.scorePercent === undefined ? "Not recorded" : `${Math.round(input.scorePercent * 10) / 10}%`],
    ["Client IP address", input.ipAddress && input.ipAddress.trim() ? input.ipAddress.trim() : "Not recorded"],
    ["Certificate", `${input.reference} (valid until ${longDate(input.endsOn)})`],
  ];
  let ty = PH - 146;
  for (const [label, value] of facts) {
    t.drawText(safe(label), { x: 48, y: ty, size: 10, font: bold, color: grey });
    const lines = wrap(sans, safe(value), 11, PW - 96 - 140);
    lines.slice(0, 2).forEach((line, i) => t.drawText(line, { x: 190, y: ty - i * 14, size: 11, font: sans, color: ink }));
    ty -= 22 + (Math.min(lines.length, 2) - 1) * 14;
  }

  ty -= 14;
  t.drawText("Modules completed", { x: 48, y: ty, size: 13, font: serif, color: ink });
  ty -= 8;
  t.drawRectangle({ x: 48, y: ty, width: PW - 96, height: 1, color: gold });
  ty -= 18;
  const mods = input.modules ?? [];
  if (mods.length === 0) {
    t.drawText("No modules recorded.", { x: 48, y: ty, size: 10, font: sans, color: grey });
  }
  let n = 0;
  for (const m of mods.slice(0, 24)) {
    n += 1;
    t.drawText(`${n}.`, { x: 48, y: ty, size: 10.5, font: sans, color: grey });
    const title = safe(m.title);
    t.drawText(title, { x: 68, y: ty, size: fit(sans, title, 330, 10.5, 7), font: sans, color: ink });
    const done = m.completedOn ? longDate(m.completedOn) : "";
    if (done) t.drawText(done, { x: PW - 48 - sans.widthOfTextAtSize(done, 10), y: ty, size: 10, font: sans, color: grey });
    ty -= 18;
  }

  t.drawText(safe("This transcript belongs to the person named above. Check it at:"), { x: 48, y: 70, size: 8.5, font: sans, color: grey });
  t.drawText(safe(input.verifyUrl), { x: 48, y: 58, size: 8.5, font: sans, color: grey });

  return pdf.save();
}
