import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { MyData } from "./types";

// Plain, text-only PDF of the "My data" export. The standard Helvetica font only covers Latin text, so
// anything outside it (emoji, other scripts) is replaced with "?" rather than failing the download.

const PAGE = { width: 595, height: 842, margin: 50 };
const INK = rgb(0.12, 0.1, 0.18);
const MUTED = rgb(0.42, 0.4, 0.5);

/** Keeps only characters the standard font can draw. Mask bullets become asterisks. */
export function latin(text: string): string {
  return text.replace(/\u2022/g, "*").replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\x7e -ÿ]/g, "?");
}

export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    // A single very long word (for example an address with no spaces) is split by characters.
    let rest = word;
    while (measure(rest) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut)) > width) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const or = (v: string | null | undefined, fallback = "Not on file") => (v && v.trim() ? v : fallback);

export async function renderMyDataPdf(data: MyData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle("My data from ELEVATE");
  pdf.setCreator("ELEVATE");

  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  const usable = PAGE.width - PAGE.margin * 2;

  const need = (height: number) => {
    if (y - height < PAGE.margin) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    }
  };
  const write = (text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const indent = opts.indent ?? 0;
    for (const line of wrapText(latin(text), usable - indent, (s) => f.widthOfTextAtSize(s, size))) {
      need(size + 4);
      y -= size + 2;
      page.drawText(line, { x: PAGE.margin + indent, y, size, font: f, color: opts.color ?? INK });
    }
    y -= opts.gap ?? 2;
  };
  const heading = (text: string) => {
    need(40);
    y -= 10;
    write(text, { size: 13, font: bold, gap: 4 });
  };
  const field = (label: string, value: string | null | undefined) => write(`${label}: ${or(value)}`, { indent: 6 });
  const empty = (text: string) => write(text, { color: MUTED, indent: 6 });

  write("My data from ELEVATE", { size: 20, font: bold, gap: 4 });
  write(`Account: ${data.account.email}`, { color: MUTED });
  write(`Generated: ${data.generatedAt}`, { color: MUTED });
  write("Government IDs, bank details and pay are shown masked. To see the full value, reveal it on your profile in ELEVATE (each reveal is logged).", { color: MUTED, gap: 6 });

  heading("Profile");
  const p = data.profile;
  if (!p) empty("No people record is linked to this account.");
  else {
    field("Employee number", p.employeeNumber);
    field("Name", [p.legalFirstName, p.legalMiddleName, p.legalLastName].filter(Boolean).join(" "));
    field("Preferred name", p.preferredName);
    field("Birth date", p.birthDate);
    field("Civil status", p.civilStatus);
    field("Work email", p.workEmail);
    field("Personal email", p.personalEmail);
    field("Mobile", p.mobile);
    field("Address", p.address);
    field("Status", p.status);
    field("Worker type", p.workerType);
    field("Position", p.position);
    field("Team", p.team);
    field("Manager", p.manager);
    field("Start date", p.startDate);
    field("End date", p.endDate);
  }

  heading("Government IDs, bank and pay (masked)");
  for (const s of data.sensitive) field(s.label, s.masked);

  heading("Emergency contacts");
  if (data.emergencyContacts.length === 0) empty("None on file.");
  for (const c of data.emergencyContacts) write(`${c.name} (${c.relationship}) ${c.phone}${c.primary ? " - primary" : ""}`, { indent: 6 });

  heading("Client assignments");
  if (data.clients.length === 0) empty("None.");
  for (const c of data.clients) write(`${c.client}: ${c.startDate} to ${c.endDate ?? "present"}${c.hoursPerWeek ? `, ${c.hoursPerWeek} hours a week` : ""}`, { indent: 6 });

  heading("Documents on file");
  if (data.documents.length === 0) empty("None. File contents are not included here; download them from the Documents tab.");
  for (const d of data.documents) write(`${d.title} (${d.type}) - ${d.verified ? "verified" : "not yet verified"}${d.expiresOn ? `, expires ${d.expiresOn}` : ""}`, { indent: 6 });

  heading("Employment history");
  if (data.history.length === 0) empty("No entries.");
  for (const h of data.history) write(`${h.date}  ${h.summary}`, { indent: 6 });

  heading("Announcements and policies you acknowledged");
  if (data.acknowledgments.length === 0) empty("None yet.");
  for (const a of data.acknowledgments) write(`${a.at.slice(0, 10)}  ${a.kind}: ${a.title}${a.version ? ` (version ${a.version})` : ""}`, { indent: 6 });

  heading("Your requests");
  if (data.requests.length === 0) empty("None.");
  for (const r of data.requests) write(`${r.createdAt.slice(0, 10)}  ${r.category}: ${r.status}`, { indent: 6 });

  heading("Activity on your record");
  if (data.activity.length === 0) empty("No entries.");
  for (const a of data.activity) write(`${a.at.slice(0, 16).replace("T", " ")} UTC  ${a.action} (by ${a.by})`, { indent: 6 });

  return pdf.save();
}
