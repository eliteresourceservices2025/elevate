/* eslint-disable security/detect-object-injection -- keys are header names read from this file and the rows are plain records */
import { parseCsv } from "@/modules/imports/csv";
import { parseDate } from "@/modules/imports/normalize";

// Pure rules for certificates: reading TalentHR's assets file into certificate records, and labelling a certificate. No database.

export type CredentialStatus = "expired" | "expiring" | "valid";
export const STATUS_LABELS: Record<CredentialStatus, string> = { expired: "Expired", expiring: "Expiring soon", valid: "Valid" };
export const STATUSES = ["expired", "expiring", "valid"] as const;

/** A certificate that ends within this many days is "expiring soon". Same window as documents. */
export const EXPIRING_WITHIN_DAYS = 30;

export type Candidate = { row: number; email: string; name: string; issuedOn: string | null; expiresOn: string };
export type SkippedRow = { row: number; reason: string };
export type ImportPlan =
  | { ok: false; error: string }
  | { ok: true; matchedFilter: number; candidates: Candidate[]; skipped: SkippedRow[] };

const find = (headers: string[], start: string) => headers.find((h) => h.toLowerCase().startsWith(start.toLowerCase()));

/**
 * Reads TalentHR's assets file. Only rows whose name contains `nameContains` are looked at (for example "HIPAA"). A row becomes a
 * certificate when it is assigned to someone (Assignment Email) and has an end date (Warranty end date, month/day/year). Prices and
 * everything else in the file are ignored. The purchase date becomes the issue date when it is a real date not after the end date.
 */
export function planCredentialImport(csvText: string, nameContains: string): ImportPlan {
  const parsed = parseCsv(csvText);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const nameCol = find(parsed.headers, "Name");
  const emailCol = find(parsed.headers, "Assignment Email");
  const endCol = find(parsed.headers, "Warranty end date");
  const buyCol = find(parsed.headers, "Purchase date");
  if (!nameCol || !emailCol) return { ok: false, error: "This does not look like TalentHR's assets file: the Name and Assignment Email columns are missing." };
  if (!endCol) return { ok: false, error: "This file has no \"Warranty end date\" column, so there are no end dates to track." };

  const needle = nameContains.trim().toLowerCase();
  const candidates: Candidate[] = [];
  const skipped: SkippedRow[] = [];
  let matchedFilter = 0;
  const seen = new Set<string>();
  for (const [i, r] of parsed.rows.entries()) {
    const name = (r[nameCol] ?? "").trim();
    if (!name.toLowerCase().includes(needle)) continue;
    matchedFilter++;
    const row = i + 1;
    const email = (r[emailCol] ?? "").trim().toLowerCase();
    if (!email) {
      skipped.push({ row, reason: "Not assigned to a person" });
      continue;
    }
    const expiresOn = parseDate(r[endCol] ?? "", "mdy");
    if (!expiresOn) {
      skipped.push({ row, reason: "No valid end date" });
      continue;
    }
    let issuedOn = buyCol ? parseDate(r[buyCol] ?? "", "mdy") : null;
    if (issuedOn && issuedOn > expiresOn) issuedOn = null;
    const key = `${email}|${name.toLowerCase()}|${expiresOn}`;
    if (seen.has(key)) {
      skipped.push({ row, reason: "Repeated in the file" });
      continue;
    }
    seen.add(key);
    candidates.push({ row, email, name: name.slice(0, 120), issuedOn, expiresOn });
  }
  return { ok: true, matchedFilter, candidates, skipped };
}
