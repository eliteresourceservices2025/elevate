import { hasErrors, hasPlaceholders, type LintIssue } from "./studio-lint";

// The publish checklist shown on a draft: what must be true (required) and what is only advised. Pure. The server enforces the
// required ones again when publishing, so this is the reviewer's view of the same rules, not a second set of rules.

export type ChecklistItem = { label: string; ok: boolean; required: boolean; detail?: string };

export function publishChecklist(p: { issues: LintIssue[]; unchangedVsLive: boolean | null; viewerIsLastEditor: boolean; openComments?: number }): ChecklistItem[] {
  const errors = p.issues.filter((i) => i.level === "error");
  const thinModules = p.issues.filter((i) => i.level === "warning" && /exam questions for this module/.test(i.message));
  const pool = p.issues.filter((i) => i.level === "warning" && /so attempts differ/.test(i.message));
  return [
    { label: "The course passes the checks", ok: !hasErrors(p.issues), required: true, detail: errors[0] ? `${errors[0].where}: ${errors[0].message}` : undefined },
    { label: "No unfinished text (TO WRITE:) is left", ok: !hasPlaceholders(p.issues), required: true },
    { label: "It differs from the live version", ok: p.unchangedVsLive !== true, required: true, detail: p.unchangedVsLive === true ? "Nothing has changed since the live version." : undefined },
    { label: "Someone other than you saved the last change", ok: !p.viewerIsLastEditor, required: true, detail: p.viewerIsLastEditor ? "You saved the last change, so another editor has to publish." : undefined },
    { label: "No editor comments are still open", ok: (p.openComments ?? 0) === 0, required: false, detail: p.openComments ? `${p.openComments} open` : undefined },
    { label: "Every module has at least 8 exam questions", ok: thinModules.length === 0, required: false, detail: thinModules[0]?.where },
    { label: "Each track's exam can rotate through at least three times its length", ok: pool.length === 0, required: false, detail: pool[0] ? `${pool[0].where}: ${pool[0].message}` : undefined },
  ];
}

export const canPublish = (items: ChecklistItem[]) => items.every((i) => !i.required || i.ok);
