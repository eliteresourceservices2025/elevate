import { EXTRA_KEYS } from "./calculate";
import {
  EXTRA_KEY_ITEM,
  HISTORY_LABELS as H,
  PAY_ITEM_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYROLL_LEVEL_LABELS,
  RATES_LABELS as R,
  SETTINGS_LABELS as S,
  WORKSHEET_LABELS as W,
  type ChangeAction,
  type PayItemType,
  type PaymentMethod,
} from "./constants";
import { formatItemValue } from "./items";
import { formatPesos } from "./money";

// Turns a decrypted change detail into what the history page shows: old and new values side by side, plus single facts. Pure.
// Detail is plain JSON written by `logChange`, so every field is read defensively: a missing or odd field is skipped, never a crash.

export type HistoryChange = { label: string; before: string | null; after: string | null };
export type HistoryFact = { label: string; value: string };
export type HistoryDetail = { changes: HistoryChange[]; facts: HistoryFact[] };
export type NameLookup = { user: (id: string) => string | null; client: (id: string) => string | null };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);

function centavos(v: unknown): string | null {
  const s = str(v);
  if (s === null || !/^-?\d+$/.test(s)) return null;
  return formatPesos(BigInt(s));
}

function itemValue(type: unknown, v: unknown): string | null {
  const s = str(v);
  if (s === null || !/^-?\d+$/.test(s) || typeof type !== "string" || !(type in PAY_ITEM_LABELS)) return null;
  return formatItemValue(type as PayItemType, BigInt(s));
}
const itemLabel = (type: unknown): string => (typeof type === "string" && type in PAY_ITEM_LABELS ? PAY_ITEM_LABELS[type as PayItemType] : H.amountKind);

/** The item's kind, with the name the Preparer gave an itemized line ("Allowance: Health allowance"). */
const namedItem = (type: unknown, name: unknown): string => (str(name) ? `${itemLabel(type)}: ${str(name)}` : itemLabel(type));

// A blank overtime setting means the standard percent applies, so history says that instead of "Not set".
const percent = (bp: unknown): string => (typeof bp === "number" ? `${bp / 100}%` : "Standard");

/** The fields of one pay line version, as labelled strings. */
function lineFields(v: Json | null, names: NameLookup): Record<string, string | null> {
  if (!v) return {};
  const client = str(v.clientId);
  const method = str(v.paymentMethod);
  return {
    [R.monthly]: centavos(v.monthlyCentavos),
    [R.hoursPerDay]: str(v.hoursPerDay),
    [R.client]: client ? (names.client(client) ?? null) : H.none,
    [R.alias]: str(v.alias) ?? H.none,
    [R.paymentMethod]: method ? (PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method) : null,
    [R.startsOn]: str(v.effectiveFrom),
    [R.lastDay]: str(v.endsOn) ?? H.notSet,
  };
}

/** Rows for every field that differs between two versions (all fields when there is no earlier version). */
function diffLines(before: Json | null, after: Json | null, names: NameLookup, onlyChanged: boolean): HistoryChange[] {
  const a = lineFields(before, names);
  const b = lineFields(after, names);
  const out: HistoryChange[] = [];
  for (const label of Object.keys(b)) {
    const next = b[label];
    const prev = before ? (a[label] ?? null) : H.none;
    if (next === null) continue;
    if (onlyChanged && prev === next) continue;
    out.push({ label, before: prev, after: next });
  }
  return out;
}

const fact = (label: string, value: unknown): HistoryFact[] => {
  const s = str(value);
  return s === null ? [] : [{ label, value: s }];
};

function settingsFields(v: Json | null): Record<string, string> {
  if (!v) return {};
  const m = obj(v.multipliersBp) ?? {};
  const out: Record<string, string> = {
    [S.divisor]: str(v.cutoffDivisor) ?? H.notSet,
    [S.warnShort]: percent(v.changeWarnBp),
  };
  for (const k of EXTRA_KEYS) out[PAY_ITEM_LABELS[EXTRA_KEY_ITEM[k]]] = percent(m[k] ?? undefined);
  return out;
}

export function describeChange(action: ChangeAction, detail: Json, names: NameLookup): HistoryDetail {
  const changes: HistoryChange[] = [];
  const facts: HistoryFact[] = [];
  const old = obj(detail.old);
  const next = obj(detail.new);

  switch (action) {
    case "access_changed": {
      const who = str(detail.userId);
      if (who) facts.push({ label: H.forPerson, value: names.user(who) ?? H.noRecord });
      const level = (v: unknown) => (typeof v === "string" && v in PAYROLL_LEVEL_LABELS ? PAYROLL_LEVEL_LABELS[v as keyof typeof PAYROLL_LEVEL_LABELS] : H.noAccess);
      changes.push({ label: H.accessLevel, before: level(detail.from), after: level(detail.to) });
      break;
    }
    case "line_created":
      changes.push(...diffLines(null, next, names, false));
      break;
    case "line_updated":
      changes.push(...diffLines(old, next, names, true));
      facts.push(...fact(H.reason, detail.reason));
      break;
    case "line_ended":
      changes.push({ label: R.lastDay, before: str(old?.endsOn) ?? H.notSet, after: str(detail.endsOn) ?? H.notSet });
      facts.push(...fact(H.reason, detail.reason));
      break;
    case "settings_changed": {
      facts.push(...fact(H.settingsFrom, detail.effectiveFrom));
      const a = settingsFields(old);
      const b = settingsFields(next);
      for (const label of Object.keys(b)) changes.push({ label, before: a[label] ?? H.notSet, after: b[label] });
      facts.push(...fact(H.reason, detail.reason));
      break;
    }
    case "item_saved": {
      const label = namedItem(detail.type, next?.label);
      const after = itemValue(detail.type, next?.value);
      const suffix = next?.state === "suggested" ? ` ${H.suggestedSuffix}` : "";
      const before = old ? `${itemValue(detail.type, old.value) ?? H.none}${old.state === "suggested" ? ` ${H.suggestedSuffix}` : ""}` : H.none;
      if (after !== null) changes.push({ label, before, after: `${after}${suffix}` });
      if (detail.assigned === true) facts.push({ label: H.assigned, value: label });
      facts.push(...fact(H.reason, next?.reason));
      break;
    }
    case "item_dismissed":
      changes.push({ label: namedItem(detail.type, old?.label), before: itemValue(detail.type, old?.value) ?? H.none, after: H.removed });
      facts.push(...fact(H.reason, detail.reason));
      break;
    case "suggestion_confirmed": {
      facts.push({ label: itemLabel(detail.type), value: detail.changed === true ? H.amountChanged : H.amountAsSuggested });
      const suggested = itemValue(detail.type, detail.suggested);
      if (suggested) facts.push({ label: H.suggestedAmount, value: suggested });
      break;
    }
    case "run_created":
      facts.push(...fact(H.lines, detail.lines));
      break;
    case "suggestions_refreshed":
      facts.push(...fact(H.items, detail.items));
      break;
    case "run_submitted":
      facts.push(...fact(H.lines, detail.lines), ...fact(H.warnings, detail.warnings));
      break;
    case "run_sent_back":
      facts.push(...fact(H.note, detail.note));
      break;
    case "run_approved":
      facts.push(...fact(H.lines, detail.lines));
      break;
    case "run_paid":
      facts.push(...fact(H.people, detail.people));
      break;
    case "payment_marked":
      facts.push(...fact(H.paidOn, detail.paidOn));
      if (detail.correction === true) facts.push({ label: H.correction, value: H.yes });
      break;
    case "list_exported":
      facts.push(...fact(H.rows, detail.rows));
      break;
    case "run_cancelled":
      facts.push(...fact(H.reason, detail.reason), ...fact(H.lines, detail.lines));
      break;
    case "run_people_synced":
      facts.push(...fact(H.peopleAdded, detail.added), ...fact(H.peopleUpdated, detail.updated), ...fact(H.peopleRemoved, detail.removed));
      break;
    case "run_line_removed":
      facts.push(...fact(H.reason, detail.reason));
      break;
    case "run_line_restored":
      break;
    case "run_marked_test":
    case "run_marked_real":
    case "run_archived":
      facts.push(...fact(H.reason, detail.reason));
      break;
    case "run_restored":
      break;
    case "timesheet_imported":
      facts.push(...fact(H.membersMatched, detail.members), ...fact(H.suggestionsWritten, detail.written), ...fact(H.keptAsTyped, detail.kept));
      break;
    case "suggestions_confirmed_all":
      facts.push(...fact(H.confirmedCount, detail.confirmed));
      break;
    case "signatory_changed": {
      // The picture itself is never in the detail, only whether there is one.
      const picture = (v: Json | null) => (v ? (v.hasSignature === true ? H.onFile : H.none) : H.notSet);
      const before = (key: string) => str(old?.[key]) ?? H.notSet;
      if (str(old?.name) !== str(next?.name)) changes.push({ label: H.signatoryName, before: before("name"), after: str(next?.name) ?? H.notSet });
      if (str(old?.title) !== str(next?.title)) changes.push({ label: H.signatoryTitle, before: before("title"), after: str(next?.title) ?? H.notSet });
      if (detail.signatureChanged === true) changes.push({ label: H.signatoryPicture, before: picture(old), after: picture(next) });
      break;
    }
    case "line_confirmed":
    case "payslip_downloaded":
    case "run_viewed":
      break;
  }
  return { changes, facts };
}
