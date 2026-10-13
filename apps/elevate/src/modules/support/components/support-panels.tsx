"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ClientPager, usePaged } from "@/components/client-pager";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
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
  const [done, setDone] = useState<{ emailed: boolean } | null>(null);

  if (done) {
    return (
      <div role="status" className="space-y-3 rounded-xl border bg-card p-5">
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
      className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            const result = await submitSupportRequest({ topic: v.topic, subject: v.subject, message: v.message, page: v.includePage && page ? page : "" });
            if (!result.ok) return void toast.error(result.error);
            markSaved();
            setDone({ emailed: result.data.emailed });
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

/** A list of requests: the person's own (read only) or the inbox (HR and Super Admin can mark them handled). */
export function SupportList({ rows, canManage, empty }: { rows: SupportRow[]; canManage: boolean; empty: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const paged = usePaged(rows, String(rows.length));
  const act = (id: string, reopen: boolean) =>
    startTransition(async () => {
      try {
        const result = await closeSupportRequest({ id, reopen });
        if (!result.ok) return void toast.error(result.error);
        toast.success(reopen ? "Reopened." : "Marked as handled.");
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {paged.rows.map((r) => (
          <li key={r.id} className="space-y-1 rounded-lg border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.subject}</span>
              <Badge variant={r.status === "open" ? "default" : "outline"}>{r.status === "open" ? "Open" : "Handled"}</Badge>
              <span className="text-xs text-muted-foreground">
                {topicLabel(r.topic)} · {when(r.createdAt)}
                {r.from ? ` · ${r.from}` : ""}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-muted-foreground">{r.message}</p>
            {r.page ? <p className="text-xs text-muted-foreground">Page: {r.page}</p> : null}
            {canManage ? (
              <Button size="xs" variant="outline" disabled={pending} onClick={() => act(r.id, r.status === "closed")}>
                {r.status === "open" ? "Mark as handled" : "Reopen"}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="requests" />
    </div>
  );
}
