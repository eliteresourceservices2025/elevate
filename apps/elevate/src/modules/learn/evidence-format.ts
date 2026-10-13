import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { toCsv } from "@/lib/csv";

// The client audit evidence report: who works for a client and whether each person held a current certificate on a date. Pure
// (no database): the CSV, the PDF and the status rule are tested directly. It names people and certificate references and dates
// only: no scores, tries, answers or addresses, because an auditor needs proof of completion, not performance.

export type CertFact = { reference: string; issuedOn: string; endsOn: string; revoked: boolean };
export type CourseStatus = { status: "valid" | "expired" | "revoked" | "none" | "later"; reference: string | null; issuedOn: string | null; validUntil: string | null };

/** Where one person stands on one course on a given day, from their certificates. */
export function statusOn(certs: CertFact[], asOf: string): CourseStatus {
  const live = certs.filter((c) => !c.revoked);
  const valid = live.filter((c) => c.issuedOn <= asOf && c.endsOn >= asOf).sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
  if (valid) return { status: "valid", reference: valid.reference, issuedOn: valid.issuedOn, validUntil: valid.endsOn };
  const ended = live.filter((c) => c.endsOn < asOf).sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
  if (ended) return { status: "expired", reference: ended.reference, issuedOn: ended.issuedOn, validUntil: ended.endsOn };
  const later = live.filter((c) => c.issuedOn > asOf).sort((a, b) => a.issuedOn.localeCompare(b.issuedOn))[0];
  if (later) return { status: "later", reference: later.reference, issuedOn: later.issuedOn, validUntil: later.endsOn };
  const revoked = certs.filter((c) => c.revoked).sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
  if (revoked) return { status: "revoked", reference: revoked.reference, issuedOn: revoked.issuedOn, validUntil: revoked.endsOn };
  return { status: "none", reference: null, issuedOn: null, validUntil: null };
}

export const STATUS_WORDS: Record<CourseStatus["status"], string> = {
  valid: "Trained (certificate valid)",
  expired: "Certificate expired",
  revoked: "Certificate revoked",
  later: "Trained after this date",
  none: "No certificate",
};

export type EvidenceRow = {
  name: string;
  position: string | null;
  assignedSince: string;
  hipaa: CourseStatus;
  cybersecurity: CourseStatus;
  /** The client's own add-on course, when it has a live one (see `EvidenceReport.addon`). */
  addon?: CourseStatus | null;
};

export type EvidenceReport = {
  clientName: string;
  asOf: string;
  generatedAt: string;
  /** The client's add-on course (its short name), or null when the client has none. Adds a column to the CSV and PDF. */
  addon?: { label: string } | null;
  rows: EvidenceRow[];
};

export function summarize(report: EvidenceReport): { people: number; hipaaValid: number; hipaaNot: number; cyberValid: number; addonValid: number | null } {
  const hipaaValid = report.rows.filter((r) => r.hipaa.status === "valid").length;
  return {
    people: report.rows.length,
    hipaaValid,
    hipaaNot: report.rows.length - hipaaValid,
    cyberValid: report.rows.filter((r) => r.cybersecurity.status === "valid").length,
    addonValid: report.addon ? report.rows.filter((r) => r.addon?.status === "valid").length : null,
  };
}

const NONE: CourseStatus = { status: "none", reference: null, issuedOn: null, validUntil: null };
const SHORT: Record<CourseStatus["status"], string> = { valid: "Valid", expired: "Expired", revoked: "Revoked", later: "Later", none: "None" };

const NOTE = "Training completion only. Scores and answers are not included. Status is as of the date shown.";

export function evidenceCsv(report: EvidenceReport): string {
  const header = [
    "Client",
    "As of",
    "Name",
    "Position",
    "Assigned since",
    "HIPAA status",
    "HIPAA certificate",
    "HIPAA issued",
    "HIPAA valid until",
    "Cybersecurity status",
    "Cybersecurity certificate",
    "Cybersecurity valid until",
    ...(report.addon ? [`${report.addon.label} status`, `${report.addon.label} certificate`, `${report.addon.label} valid until`] : []),
  ];
  const rows = report.rows.map((r) => [
    report.clientName,
    report.asOf,
    r.name,
    r.position,
    r.assignedSince,
    STATUS_WORDS[r.hipaa.status],
    r.hipaa.reference,
    r.hipaa.issuedOn,
    r.hipaa.validUntil,
    STATUS_WORDS[r.cybersecurity.status],
    r.cybersecurity.reference,
    r.cybersecurity.validUntil,
    ...(report.addon ? [STATUS_WORDS[(r.addon ?? NONE).status], (r.addon ?? NONE).reference, (r.addon ?? NONE).validUntil] : []),
  ]);
  rows.push([], [NOTE]);
  return toCsv(header, rows);
}

/** The standard PDF fonts draw Latin-1 only; anything else becomes "?" (same rule as the other ELEVATE PDFs). */
const latin = (t: string) =>
  Array.from(t.normalize("NFC"))
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 63;
      return (code >= 32 && code <= 126) || (code >= 160 && code <= 255) ? ch : "?";
    })
    .join("");

function fitText(font: PDFFont, text: string, size: number, max: number): string {
  let t = latin(text);
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > max) t = t.slice(0, -1);
  return t;
}

export async function evidencePdf(report: EvidenceReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Training evidence: ${latin(report.clientName)}`);
  pdf.setAuthor("Elite Resource Services");
  pdf.setCreator("ELEVATE");
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const purple = rgb(0x6c / 255, 0x1a / 255, 0xba / 255);
  const ink = rgb(0.13, 0.13, 0.17);
  const grey = rgb(0.4, 0.4, 0.45);
  const W = 595;
  const H = 842;
  const M = 40;
  const withAddon = Boolean(report.addon);
  const cols = withAddon
    ? [
        { label: "Name", x: M, w: 118 },
        { label: "Assigned since", x: M + 118, w: 66 },
        { label: "HIPAA status", x: M + 184, w: 104 },
        { label: "Certificate", x: M + 288, w: 92 },
        { label: "Valid until", x: M + 380, w: 62 },
        { label: fitText(bold, report.addon?.label ?? "Add-on", 8.5, 70), x: M + 442, w: 73 },
      ]
    : [
        { label: "Name", x: M, w: 150 },
        { label: "Assigned since", x: M + 150, w: 72 },
        { label: "HIPAA status", x: M + 222, w: 120 },
        { label: "Certificate", x: M + 342, w: 100 },
        { label: "Valid until", x: M + 442, w: 73 },
      ];
  const s = summarize(report);

  let page = pdf.addPage([W, H]);
  let y = H - M;
  const header = () => {
    page.drawText("ELITE RESOURCE SERVICES", { x: M, y, size: 9, font: bold, color: purple });
    y -= 22;
    page.drawText("Training evidence", { x: M, y, size: 20, font: bold, color: ink });
    y -= 20;
    page.drawText(fitText(sans, `Client: ${report.clientName}`, 11, W - 2 * M), { x: M, y, size: 11, font: sans, color: ink });
    y -= 15;
    page.drawText(`Status as of ${report.asOf}. Prepared ${report.generatedAt.slice(0, 10)}.`, { x: M, y, size: 9, font: sans, color: grey });
    y -= 22;
  };
  const tableHead = () => {
    for (const c of cols) page.drawText(c.label, { x: c.x, y, size: 8.5, font: bold, color: grey });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: grey });
    y -= 13;
  };
  header();
  page.drawText(`${s.people} ${s.people === 1 ? "person" : "people"} assigned. HIPAA training valid: ${s.hipaaValid}. Not valid: ${s.hipaaNot}.${s.addonValid !== null ? ` ${report.addon?.label}: ${s.addonValid} valid.` : ""}`, { x: M, y, size: 10.5, font: bold, color: ink });
  y -= 24;
  tableHead();

  for (const r of report.rows) {
    if (y < M + 40) {
      page = pdf.addPage([W, H]);
      y = H - M;
      tableHead();
    }
    const cells = [r.name, r.assignedSince, withAddon ? SHORT[r.hipaa.status] : STATUS_WORDS[r.hipaa.status], r.hipaa.reference ?? "", r.hipaa.validUntil ?? "", ...(withAddon ? [SHORT[(r.addon ?? NONE).status]] : [])];
    cells.forEach((text, i) => page.drawText(fitText(sans, text, 9, cols[i].w - 6), { x: cols[i].x, y, size: 9, font: sans, color: r.hipaa.status === "valid" || i < 2 ? ink : rgb(0.6, 0.1, 0.1) }));
    y -= 15;
  }
  if (report.rows.length === 0) page.drawText("Nobody was assigned to this client on that date.", { x: M, y, size: 10, font: sans, color: grey });

  const last = pdf.getPages().at(-1)!;
  last.drawText(NOTE, { x: M, y: M - 8, size: 8, font: sans, color: grey });
  return pdf.save();
}
