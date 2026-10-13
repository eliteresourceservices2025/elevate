"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  archiveEmployee,
  assignClient,
  getTrainingReadiness,
  cancelChangeRequest,
  endAssignment,
  setCustomFieldValues,
} from "../actions";
import { CHANGE_CATEGORY_LABELS, type ChangeCategory, type CustomFieldType } from "../constants";

/** Runs an action, toasts the error or a success message, then refreshes the server data. */
function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { run, pending };
}

export function ArchiveButton({ employeeId, archived }: { employeeId: string; archived: boolean }) {
  const { run, pending } = useRun();
  return (
    <Button
      variant={archived ? "outline" : "ghost"}
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!archived && !window.confirm("Archive this person? They disappear from the directory but their history is kept.")) return;
        run(() => archiveEmployee({ employeeId, restore: archived }), archived ? "Record restored." : "Record archived.");
      }}
    >
      {archived ? "Restore" : "Archive"}
    </Button>
  );
}

export function PendingRequests({
  requests,
  canCancel,
}: {
  requests: { id: string; category: ChangeCategory; createdAt: Date }[];
  canCancel: boolean;
}) {
  const { run, pending } = useRun();
  if (requests.length === 0) return null;
  return (
    <div role="status" className="rounded-xl border border-brand-gold bg-brand-gold/10 p-4 text-sm">
      <p className="font-medium">Waiting for HR approval</p>
      <ul className="mt-2 space-y-1">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3">
            <span>{label(r.category)}</span>
            {canCancel ? (
              <Button variant="ghost" size="xs" disabled={pending} onClick={() => run(() => cancelChangeRequest({ requestId: r.id }), "Request cancelled.")}>
                Cancel request
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const label = (c: ChangeCategory) => CHANGE_CATEGORY_LABELS[c]; // eslint-disable-line security/detect-object-injection

export function AssignClientForm({
  employeeId,
  clients,
  today,
}: {
  employeeId: string;
  clients: { id: string; name: string; isActive: boolean; handlesPhi?: boolean }[];
  today: string;
}) {
  const { run, pending } = useRun();
  const [clientId, setClientId] = useState("");
  type Ready = { state: string; validUntil?: string; dueOn?: string; overdue?: boolean; endedOn?: string };
  const [fetched, setFetched] = useState<{ key: string; value: Ready; addon: { label: string; readiness: Ready } | null } | null>(null);
  const chosen = clients.find((c) => c.id === clientId);
  const handlesPhi = Boolean(chosen?.handlesPhi);
  const key = `${employeeId}:${clientId}`;
  const readiness = handlesPhi && fetched?.key === key ? fetched.value : null;
  const addon = clientId && fetched?.key === key ? fetched.addon : null;

  // Show where the person stands: HIPAA when the chosen client works with patient information, and the client's own add-on course
  // when it has one. Reminders only: assigning is never blocked.
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    getTrainingReadiness({ employeeId, clientId })
      .then((r) => {
        if (!cancelled && r.ok) setFetched({ key, value: r.data.readiness, addon: r.data.addon });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clientId, employeeId, key]);
  const [startDate, setStartDate] = useState(today);
  const [hours, setHours] = useState("");
  const open = clients.filter((c) => c.isActive);

  return (
    <form
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-4 sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => assignClient({ employeeId, clientId, startDate, hoursPerWeek: hours }), "Client assigned.", () => {
          setClientId("");
          setHours("");
        });
      }}
    >
      <SelectField id="a-client" label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
        <option value="">Choose…</option>
        {open.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <TextField id="a-start" label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
      <TextField id="a-hours" label="Hours per week" type="number" min={1} max={80} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
      <Button type="submit" disabled={pending || !clientId}>
        Assign
      </Button>
      {handlesPhi && readiness ? (
        <p role="status" className={`text-sm sm:col-span-4 ${readiness.state === "passed" ? "text-muted-foreground" : "rounded-lg border border-amber-500/40 bg-amber-500/10 p-2"}`}>
          {readiness.state === "passed"
            ? `HIPAA training: passed, valid until ${readiness.validUntil}.`
            : readiness.state === "open"
              ? `HIPAA training: ${readiness.overdue ? "overdue since" : "not yet passed, due"} ${readiness.dueOn}. `
              : readiness.state === "expired"
                ? `HIPAA training: the certificate ended on ${readiness.endedOn}. `
                : "HIPAA training: nothing on record yet. "}
          {readiness.state !== "passed" ? "This client works with patient information. You can still assign; this is a reminder only." : null}
        </p>
      ) : null}
      {addon ? (
        <p role="status" className={`text-sm sm:col-span-4 ${addon.readiness.state === "passed" ? "text-muted-foreground" : "rounded-lg border border-amber-500/40 bg-amber-500/10 p-2"}`}>
          {addon.readiness.state === "passed"
            ? `${addon.label}: passed, valid until ${addon.readiness.validUntil}.`
            : addon.readiness.state === "open"
              ? `${addon.label}: ${addon.readiness.overdue ? "overdue since" : "not yet passed, due"} ${addon.readiness.dueOn}. `
              : addon.readiness.state === "expired"
                ? `${addon.label}: the certificate ended on ${addon.readiness.endedOn}. `
                : `${addon.label}: nothing on record yet. This course is assigned automatically once the person is on the client. `}
          {addon.readiness.state !== "passed" ? "A reminder only." : null}
        </p>
      ) : null}
    </form>
  );
}

export function EndAssignmentButton({ assignmentId, today }: { assignmentId: string; today: string }) {
  const { run, pending } = useRun();
  const [open, setOpen] = useState(false);
  const [endDate, setEndDate] = useState(today);

  if (!open)
    return (
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        End
      </Button>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <Label htmlFor={`end-${assignmentId}`} className="sr-only">
        Last day
      </Label>
      <Input id={`end-${assignmentId}`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-7 w-36" />
      <Button size="xs" disabled={pending} onClick={() => run(() => endAssignment({ assignmentId, endDate }), "Assignment ended.")}>
        Confirm
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function CustomFieldsForm({
  employeeId,
  fields,
}: {
  employeeId: string;
  fields: { id: string; label: string; fieldType: CustomFieldType; options: string[]; isRequired: boolean; value: string }[];
}) {
  const { run, pending } = useRun();
  const [values, setValues] = useState<ReadonlyMap<string, string>>(new Map(fields.map((f) => [f.id, f.value])));

  if (fields.length === 0) return <p className="text-sm text-muted-foreground">No custom fields yet.</p>;

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const changed = Object.fromEntries(fields.filter((f) => (values.get(f.id) ?? "") !== f.value).map((f) => [f.id, values.get(f.id) ?? ""]));
        run(() => setCustomFieldValues({ employeeId, values: changed }), "Saved.");
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const common = {
            id: `cf-${f.id}`,
            label: f.isRequired ? `${f.label} (required)` : f.label,
            value: values.get(f.id) ?? "",
          };
          const set = (v: string) => setValues((prev) => new Map(prev).set(f.id, v));
          return f.fieldType === "select" ? (
            <SelectField key={f.id} {...common} onChange={(e) => set(e.target.value)}>
              <option value="">{f.isRequired ? "Choose…" : "Not set"}</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </SelectField>
          ) : (
            <TextField key={f.id} {...common} type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : "text"} onChange={(e) => set(e.target.value)} />
          );
        })}
      </div>
      <Button type="submit" disabled={pending}>
        Save custom fields
      </Button>
    </form>
  );
}
