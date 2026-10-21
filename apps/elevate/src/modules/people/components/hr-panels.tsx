"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  archiveEmployee,
  assignClient,
  getTrainingReadiness,
  cancelChangeRequest,
  endAssignment,
  setCustomFieldValues,
  updateAssignment,
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

/** More actions on a profile: archive or restore the record. Archiving still asks first. */
export function ArchiveMenu({ employeeId, archived }: { employeeId: string; archived: boolean }) {
  const { run, pending } = useRun();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More actions" disabled={pending} className={cn(buttonVariants({ variant: "outline", size: "icon" }), "outline-none")}>
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          variant={archived ? "default" : "destructive"}
          onClick={() => {
            if (!archived && !window.confirm("Archive this person? They disappear from the directory but their history is kept.")) return;
            run(() => archiveEmployee({ employeeId, restore: archived }), archived ? "Record restored." : "Record archived.");
          }}
        >
          {archived ? "Restore record" : "Archive"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <Alert variant="warning" role="status" className="p-4">
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
    </Alert>
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
  const [fetched, setFetched] = useState<{ key: string; value: Ready; addons: { label: string; readiness: Ready }[] } | null>(null);
  const chosen = clients.find((c) => c.id === clientId);
  const handlesPhi = Boolean(chosen?.handlesPhi);
  const key = `${employeeId}:${clientId}`;
  const readiness = handlesPhi && fetched?.key === key ? fetched.value : null;
  const addons = clientId && fetched?.key === key ? fetched.addons : [];

  // Show where the person stands: HIPAA when the chosen client works with patient information, and the client's own add-on course
  // when it has one. Reminders only: assigning is never blocked.
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    getTrainingReadiness({ employeeId, clientId })
      .then((r) => {
        if (!cancelled && r.ok) setFetched({ key, value: r.data.readiness, addons: r.data.addons });
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
        <p role="status" className={`text-sm sm:col-span-4 ${readiness.state === "passed" ? "text-muted-foreground" : "rounded-lg border border-warning/40 bg-warning-surface p-2"}`}>
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
      {addons.map((addon) => (
        <p key={addon.label} role="status" className={`text-sm sm:col-span-4 ${addon.readiness.state === "passed" ? "text-muted-foreground" : "rounded-lg border border-warning/40 bg-warning-surface p-2"}`}>
          {addon.readiness.state === "passed"
            ? `${addon.label}: passed, valid until ${addon.readiness.validUntil}.`
            : addon.readiness.state === "open"
              ? `${addon.label}: ${addon.readiness.overdue ? "overdue since" : "not yet passed, due"} ${addon.readiness.dueOn}. `
              : addon.readiness.state === "expired"
                ? `${addon.label}: the certificate ended on ${addon.readiness.endedOn}. `
                : `${addon.label}: nothing on record yet. This course is assigned automatically once the person is on the client. `}
          {addon.readiness.state !== "passed" ? "A reminder only." : null}
        </p>
      ))}
    </form>
  );
}

export function EditAssignment({
  assignment,
  clients,
}: {
  assignment: { id: string; clientId: string; startDate: string; endDate: string | null; hoursPerWeek: string | null; clientName: string };
  clients: { id: string; name: string; isActive: boolean }[];
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>Edit assignment</Button>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit assignment</DialogTitle>
            <DialogDescription>Correct the assigned client, dates or hours for this person.</DialogDescription>
          </DialogHeader>
          {editing ? <EditAssignmentForm assignment={assignment} clients={clients} onClose={() => setEditing(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditAssignmentForm({
  assignment,
  clients,
  onClose,
}: {
  assignment: { id: string; clientId: string; startDate: string; endDate: string | null; hoursPerWeek: string | null; clientName: string };
  clients: { id: string; name: string; isActive: boolean }[];
  onClose: () => void;
}) {
  const { run, pending } = useRun();
  const [clientId, setClientId] = useState(assignment.clientId);
  const [startDate, setStartDate] = useState(assignment.startDate);
  const [endDate, setEndDate] = useState(assignment.endDate ?? "");
  const [hours, setHours] = useState(assignment.hoursPerWeek ?? "");
  const consequential = clientId !== assignment.clientId || startDate !== assignment.startDate || endDate !== (assignment.endDate ?? "");
  const save = () => run(() => updateAssignment({ assignmentId: assignment.id, clientId, startDate, endDate, hoursPerWeek: hours }), "Assignment corrected. Review affected records and request a historical analytics rebuild if needed.", onClose);

  return (
    <div className="space-y-3 text-left">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        if (consequential && !window.confirm("Correct this assignment? Historical evidence, eligibility and reports can change. Review extra-hours and training records. Earlier exports, approvals, training due dates and certificates are not rewritten. Older analytics may need an operator rebuild.")) return;
        save();
      }}>
        <SelectField id={`client-${assignment.id}`} label="Assigned client" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
          {clients.filter((c) => c.isActive || c.id === assignment.clientId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          {!clients.some((c) => c.id === assignment.clientId) ? <option value={assignment.clientId}>{assignment.clientName} (inactive)</option> : null}
        </SelectField>
        <TextField id={`start-${assignment.id}`} label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        <TextField id={`finish-${assignment.id}`} label="End date (optional)" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <TextField id={`hours-${assignment.id}`} label="Hours per week" type="number" min={0.1} max={80} step={0.1} value={hours} onChange={(e) => setHours(e.target.value)} />
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" size="xs" disabled={pending}>Save</Button>
          <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={onClose}>Cancel</Button>
        </div>
      </form>
      <p className="text-sm text-muted-foreground">
        Changing the assigned client affects only this assignment. To fix a typo for everyone, <Link href="/people/clients" className="text-primary underline-offset-4 hover:underline">rename a client for everyone</Link> in the client catalog; that also changes names shown in historical views.
      </p>
    </div>
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
