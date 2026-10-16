// Pure rules for ELEVATE Sign (C4). No database, no server-only: used by the actions, the pages and the tests.

export const ENVELOPE_STATUSES = ["draft", "out", "completed", "declined", "voided", "expired"] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];
/** Once an envelope is in one of these it never changes again. */
export const TERMINAL_STATUSES: readonly EnvelopeStatus[] = ["completed", "declined", "voided", "expired"];

export const STATUS_LABELS: Record<EnvelopeStatus, string> = {
  draft: "Draft",
  out: "Out for signature",
  completed: "Completed",
  declined: "Declined",
  voided: "Voided",
  expired: "Expired",
};

export const SIGNER_STATUSES = ["waiting", "pending", "signed", "declined", "cancelled"] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];
export const SIGNER_STATUS_LABELS: Record<SignerStatus, string> = { waiting: "Waiting for earlier signers", pending: "Needs to sign", signed: "Signed", declined: "Declined", cancelled: "Cancelled" };

export const SIGNING_ORDERS = ["sequential", "parallel"] as const;
export type SigningOrder = (typeof SIGNING_ORDERS)[number];

export const EVENT_TYPES = ["created", "sent", "viewed", "consented", "signed", "declined", "voided", "expired", "reminded", "sealed"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const SIGNATURE_KINDS = ["typed", "drawn"] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

export const MAX_PDF_BYTES = 8 * 1024 * 1024; // the sealed copy adds pages and must stay under the 10 MB bucket limit
export const MAX_PDF_PAGES = 100;
export const MAX_SIGNERS = 10;
/** A document written inside ELEVATE: the Markdown source is limited so the PDF stays well under MAX_PDF_BYTES and MAX_PDF_PAGES. */
export const MAX_COMPOSED_CHARS = 60_000;
export const MIN_COMPOSED_CHARS = 20;
export const DEFAULT_EXPIRY_DAYS = 14;
export const MAX_EXPIRY_DAYS = 90;
export const REMINDER_EVERY_DAYS = 3;
export const MAX_SIGNATURE_PNG_BYTES = 60 * 1024;
export const MAX_SIGNATURE_PNG_SIZE = { width: 1000, height: 400 };

/** The words the signer agrees to. Bump the version when the wording changes; the version is stored with each signature. */
export const CONSENT_VERSION = "2026-10";
export const CONSENT_TEXT =
  "I agree to sign this document electronically. I understand my typed or drawn signature has the same effect as a handwritten one, that ELEVATE records the time, my IP address and how I signed in, and that I have read the document.";

/**
 * Standard PDF fonts only know Latin-1 letters. A typed signature must be made of those so it can be drawn in the PDF
 * (a name with ñ or é is fine; other alphabets should draw their signature instead).
 */
export function isTypedSignatureEncodable(text: string): boolean {
  return text.length > 0 && /^[\x20-\x7E -ÿ]+$/.test(text);
}

/**
 * Word and Google Docs use curly quotes, long dashes, bullets and ellipses that the standard PDF font cannot draw (they would print
 * as "?"). They become their plain equivalents before the document is rendered.
 */
export function normalizeTypography(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•●○▪‣]/g, "-")
    .replace(/[   ​﻿]/g, " ");
}

/** Initials are 2 to 5 letters the PDF font can draw (Latin-1), no digits or symbols that would not read as initials. */
export function isValidInitials(text: string): boolean {
  return /^[A-Za-zÀ-ÖØ-öø-ÿ. -]{2,5}$/.test(text.trim()) && isTypedSignatureEncodable(text.trim());
}

/** "Maria Santos" -> "MS": a starting suggestion the signer can change. */
export function suggestInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]].map((p) => p[0]).join("") : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase().slice(0, 5);
}

/** True when pages is exactly 1..count with no gaps or repeats: the signer initialed every page. */
export function initialedAllPages(pages: number[], count: number): boolean {
  if (pages.length !== count) return false;
  const seen = new Set(pages);
  return seen.size === count && pages.every((n) => Number.isInteger(n) && n >= 1 && n <= count);
}

export type SignerLike = { position: number; status: SignerStatus };

/**
 * Who may sign right now. Parallel: everyone who has not finished. Sequential: only the earliest position that has not signed
 * (people at the same position sign together).
 */
export function signersToActivate(order: SigningOrder, signers: SignerLike[]): number[] {
  const open = signers.filter((s) => s.status === "waiting" || s.status === "pending");
  if (open.length === 0) return [];
  if (order === "parallel") return [...new Set(open.map((s) => s.position))];
  return [Math.min(...open.map((s) => s.position))];
}

export const allSigned = (signers: SignerLike[]) => signers.length > 0 && signers.every((s) => s.status === "signed");

/** When the next reminder is due for a pending signer: never before the first notice, then every REMINDER_EVERY_DAYS. */
export function reminderDue(lastNoticeAt: Date, now: Date): boolean {
  return now.getTime() - lastNoticeAt.getTime() >= REMINDER_EVERY_DAYS * 86_400_000;
}

/** A short reference people can quote, from an envelope id: ES-XXXXXXXX. */
export const envelopeReference = (id: string) => `ES-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

export const isPdf = (bytes: Uint8Array) => bytes.length > 8 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reads a PNG's size from its header, or null when it is not a PNG. Guards the drawn-signature upload. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  // eslint-disable-next-line security/detect-object-injection -- numeric index into a fixed signature
  if (bytes.length < 24 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
