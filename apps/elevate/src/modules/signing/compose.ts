import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { formatDateOnly } from "@/lib/time";
import { formatAddress } from "@/modules/people/address-data";
import { employees } from "@/modules/people/schema";
import { parseMarkdown } from "@/lib/markdown";
import { ActionFailure } from "@/lib/run-action";
import { renderLetterheadPdf } from "./letterhead-pdf";
import { MAX_COMPOSED_CHARS, MIN_COMPOSED_CHARS, normalizeTypography } from "./constants";
import { fieldLabel, fillFields, missingFields } from "./merge";

/**
 * A document written inside ELEVATE (HR types or pastes it in the editor) becomes a PDF here. From then on it is an ordinary
 * envelope: the PDF is the original (never edited), it is fingerprinted, signed and sealed like an uploaded file.
 * Standard Helvetica draws Latin-1 only; other characters print as "?", which the editor says up front.
 */
export async function renderComposedPdf(title: string, markdown: string): Promise<Uint8Array> {
  const text = normalizeTypography(markdown).replace(/\r\n?/g, "\n").trim();
  if (text.length < MIN_COMPOSED_CHARS) throw new ActionFailure("Write the document (at least a few sentences).");
  if (text.length > MAX_COMPOSED_CHARS) throw new ActionFailure("The document is too long (60,000 characters at most).");
  const blocks = parseMarkdown(text, MAX_COMPOSED_CHARS);
  if (blocks.length === 0) throw new ActionFailure("Write the document (at least a few sentences).");
  return renderLetterheadPdf({ title, blocks });
}

/** What each person's record says for the merge fields (name, address, role, start date, manager), keyed by their ELEVATE user id. */
export async function loadSigneeValues(userIds: string[]): Promise<Map<string, { name: string; values: Record<string, string> }>> {
  const out = new Map<string, { name: string; values: Record<string, string> }>();
  if (userIds.length === 0) return out;
  const mgr = alias(employees, "mgr");
  const rows = await db
    .select({
      userId: employees.userId,
      first: employees.legalFirstName,
      middle: employees.legalMiddleName,
      last: employees.legalLastName,
      addressLine: employees.addressLine,
      city: employees.city,
      province: employees.province,
      postalCode: employees.postalCode,
      country: employees.country,
      position: employees.position,
      startDate: employees.startDate,
      mgrFirst: mgr.legalFirstName,
      mgrLast: mgr.legalLastName,
    })
    .from(employees)
    .leftJoin(mgr, eq(mgr.id, employees.managerId))
    .where(and(inArray(employees.userId, userIds), isNull(employees.archivedAt)));
  for (const r of rows) {
    if (!r.userId) continue;
    const name = [r.first, r.middle, r.last].filter(Boolean).join(" ");
    const address = formatAddress(r);
    out.set(r.userId, {
      name,
      values: {
        contractor_name: name,
        contractor_address: r.addressLine ? address : "",
        role_title: r.position ?? "",
        start_date: r.startDate ? formatDateOnly(r.startDate) : "",
        reporting_line: r.mgrFirst && r.mgrLast ? `${r.mgrFirst} ${r.mgrLast}` : "",
      },
    });
  }
  return out;
}

/** Checks that every person has a value for each field the text uses. Throws one message naming who is missing what (up to 8 people). */
export function assertSigneeValues(markdown: string, people: Map<string, { name: string; values: Record<string, string> }>, userIds: string[], typed: Record<string, string> = {}): void {
  const problems: string[] = [];
  for (const id of userIds) {
    const p = people.get(id);
    if (!p) {
      problems.push("someone without a people record");
      continue;
    }
    const missing = missingFields(markdown, { ...p.values, ...typed });
    if (missing.length) problems.push(`${p.name}: ${missing.map(fieldLabel).join(", ")}`);
  }
  if (problems.length) {
    const shown = problems.slice(0, 8).join("; ");
    throw new ActionFailure(`Some details are missing on people's records, so nothing was sent. Add them on the profile first. ${shown}${problems.length > 8 ? `; and ${problems.length - 8} more` : ""}.`);
  }
}

/** The PDF for one person: the text with their details filled in. */
export async function renderForSignee(title: string, markdown: string, person: { values: Record<string, string> }, typed: Record<string, string> = {}): Promise<Uint8Array> {
  return renderComposedPdf(title, fillFields(markdown, { ...person.values, ...typed }));
}
