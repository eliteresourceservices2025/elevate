// The certificate of completion as a PDF. This file is kept IDENTICAL in two places (a test in ELEVATE compares them):
//   apps/learn/src/lib/certificate-pdf.ts                 (the download button on the certificate page)
//   apps/elevate/src/modules/learn/certificate-pdf.ts     (the copy emailed when the certificate is recorded)
// It imports only pdf-lib and has no other dependency, so it can be shared this way. Change both together.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export type CertificateInput = {
  holderName: string;
  courseTitle: string;
  /** ISO dates, YYYY-MM-DD. */
  issuedOn: string;
  endsOn: string;
  reference: string;
  /** Where anyone can check the certificate (shown as text, not a link to anything personal). */
  verifyUrl: string;
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

export async function renderCertificatePdf(input: CertificateInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Certificate of completion");
  pdf.setAuthor("Elite Resource Services");
  pdf.setCreator("ELEVATE Learn");
  pdf.setProducer("ELEVATE Learn");

  const W = 842;
  const H = 595;
  const page = pdf.addPage([W, H]);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const purple = rgb(0x6c / 255, 0x1a / 255, 0xba / 255);
  const gold = rgb(0xe2 / 255, 0xbe / 255, 0x2b / 255);
  const ink = rgb(0.13, 0.13, 0.17);
  const grey = rgb(0.4, 0.4, 0.45);

  // Frame: a purple border, a thin gold line inside it, and a gold bar under the heading.
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: purple, borderWidth: 4 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: gold, borderWidth: 1 });

  const center = (text: string, y: number, font: PDFFont, size: number, color = ink) => {
    const t = safe(text);
    const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: (W - w) / 2, y, size, font, color });
  };
  const fitted = (text: string, y: number, font: PDFFont, start: number, min: number, color = ink) => {
    const t = safe(text);
    center(t, y, font, fit(font, t, W - 160, start, min), color);
  };

  center("ELITE RESOURCE SERVICES", H - 92, bold, 14, purple);
  center("Certificate of completion", H - 150, serif, 40, ink);
  page.drawRectangle({ x: W / 2 - 60, y: H - 168, width: 120, height: 3, color: gold });

  center("This certifies that", H - 214, sans, 14, grey);
  fitted(input.holderName, H - 262, serif, 36, 16, purple);
  center("has completed the training", H - 302, sans, 14, grey);
  fitted(input.courseTitle, H - 340, bold, 24, 12, ink);
  center("for Elite Resource Services.", H - 372, sans, 14, grey);

  center(`Issued ${longDate(input.issuedOn)}   |   Valid until ${longDate(input.endsOn)}`, H - 425, bold, 13, ink);
  center(`Reference ${input.reference}`, H - 449, sans, 12, grey);

  center("This is ERS training completion, not an official certification issued by any government body.", 96, sans, 9.5, grey);
  fitted(`To check this certificate, enter the reference and the full name at ${input.verifyUrl}`, 78, sans, 9.5, 6, grey);

  return pdf.save();
}
