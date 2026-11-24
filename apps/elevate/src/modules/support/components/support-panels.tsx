"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFormDialog } from "@/components/form-dialog";
import { toast } from "@/components/feedback-dialog";
import { ReportInbox, type InboxRow } from "@/components/reports/report-inbox";
import { ReportThread } from "@/components/reports/report-thread";
import { StatusChip } from "@/components/status-chip";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWarnWhenEdited } from "@/components/unsaved-changes";
import { closeSupportRequest, submitSupportRequest } from "../actions";
import { MESSAGE_MAX, SUBJECT_MAX, SUPPORT_TOPICS, topicLabel } from "../constants";
import type { SupportRow } from "../queries";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The request form. `page` is the page the person came from, offered as an option to include. */
export function SupportForm({ page, email }: { page: string | null; email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({ topic: "sign_in", subject: "", message: "", includePage: Boolean(page) });
  const { markSaved } = useWarnWhenEdited({ subject: v.subject, message: v.message });
  const dialog = useFormDialog();
  const [done, setDone] = useState<{ emailed: boolean } | null>(null);

  if (done) {
    return (
      <div role="status" className="space-y-3">
        <h2 className="text-lg font-semibold">We got your request</h2>
        <p className="text-sm text-muted-foreground">
          HR and the administrators were told in ELEVATE{done.emailed ? ", and the request was emailed to support" : ""}. We will reply to <strong>{email}</strong>. You can follow it below.
        </p>
        <Button variant="outline" size="sm" onClick={() => { setDone(null); setV({ topic: "sign_in", subject: "", message: "", includePage: Boolean(page) }); }}>
          Send another request
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            const result = await submitSupportRequest({ topic: v.topic, subject: v.subject, message: v.message, page: v.includePage && page ? page : "" });
            if (!result.ok) return void toast.error(result.error);
            markSaved();
            setDone({ emailed: result.data.emailed });
            dialog?.markClean();
            router.refresh();
          } catch {
            toast.error("No connection. Try again.");
          }
        });
      }}
    >
      <SelectField id="sp-topic" label="What is it about?" value={v.topic} onChange={(e) => setV((s) => ({ ...s, topic: e.target.value }))}>
        {SUPPORT_TOPICS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </SelectField>
      <TextField id="sp-subject" label="Short title" value={v.subject} onChange={(e) => setV((s) => ({ ...s, subject: e.target.value }))} maxLength={SUBJECT_MAX} required />
      <div className="space-y-1.5">
        <Label htmlFor="sp-message">What happened?</Label>
        <Textarea id="sp-message" value={v.message} onChange={(e) => setV((s) => ({ ...s, message: e.target.value }))} rows={7} maxLength={MESSAGE_MAX} required aria-describedby="sp-message-hint" />
        <p id="sp-message-hint" className="text-xs text-muted-foreground">
          {v.message.length} / {MESSAGE_MAX}. Say what you tried and what you saw. Please do not include passwords, client names or patient information.
        </p>
      </div>
      {page ? (
        <label htmlFor="sp-page" className="flex items-center gap-2 text-sm">
          <input id="sp-page" type="checkbox" className="size-4 accent-primary" checked={v.includePage} onChange={(e) => setV((s) => ({ ...s, includePage: e.target.checked }))} />
          Include the page I was on ({page})
        </label>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send to support"}
      </Button>
    </form>
  );
}

const SUPPORT_GROUPS = [
  { value: "open", label: "Open" },
  { value: "done", label: "Handled" },
];

function SupportDetail({ row, canManage }: { row: SupportRow; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (reopen: boolean) =>
    startTransition(async () => {
      try {
        const result = await closeSupportRequest({ id: row.id, reopen });
        if (!result.ok) return void toast.error(result.error);
        toast.success(reopen ? "Reopened." : "Marked as handled.");
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{row.subject}</h2>
          <StatusChip tone={row.status === "open" ? "warning" : "success"}>{row.status === "open" ? "Open" : "Handled"}</StatusChip>
        </div>
        <p className="text-sm text-muted-foreground">
          {topicLabel(row.topic)} · {when(row.createdAt)}
          {row.from ? ` · ${row.from}` : ""}
        </p>
      </div>
      <p className="whitespace-pre-wrap text-sm">{row.message}</p>
      {row.page ? <p className="text-xs text-muted-foreground">Page: {row.page}</p> : null}
      <ReportThread key={row.id} type="support" id={row.id} />
      {canManage ? (
        <div className="border-t pt-3">
          <Button size="sm" variant={row.status === "open" ? "default" : "outline"} disabled={pending} onClick={() => act(row.status === "closed")}>
            {row.status === "open" ? "Mark as handled" : "Reopen"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The requests: the person's own, or the inbox (HR and Super Admin read, write back and mark them handled). */
export function SupportList({ rows, canManage, empty }: { rows: SupportRow[]; canManage: boolean; empty: string }) {
  const items: InboxRow[] = rows.map((r) => ({
    id: r.id,
    title: canManage && r.from ? r.from : r.subject,
    subtitle: canManage ? `${r.subject}: ${r.message}` : r.message,
    when: new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    sortMs: new Date(r.createdAt).getTime(),
    status: { label: r.status === "open" ? "Open" : "Handled", tone: r.status === "open" ? "warning" : "success" },
    group: r.status === "open" ? "open" : "done",
    messages: r.messageCount,
    search: `${r.subject} ${r.message} ${r.from ?? ""} ${topicLabel(r.topic)}`,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (
    <ReportInbox
      rows={items}
      groups={SUPPORT_GROUPS}
      defaultGroup={canManage ? "open" : "all"}
      label="support requests"
      emptyTitle={canManage ? "Nothing is waiting" : "No requests yet"}
      emptyText={empty}
      renderDetail={(id) => <SupportDetail row={byId.get(id)!} canManage={canManage} />}
    />
  );
}
