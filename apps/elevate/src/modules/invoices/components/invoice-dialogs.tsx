"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useRun } from "@/modules/recruiting/components/use-run";
import { addBillRate, createInvoice, previewInvoiceRun } from "../actions";

type Preview = {
  period: string;
  status: string;
  clients: { clientId: string; clientName: string; people: number; hours: string; unconfirmedLines: number; rate: string | null; total: string | null; existing: number }[];
  noClient: string[];
  noHours: string[];
};

export type RunOption = { id: string; label: string };

function NewInvoiceForm({ runs }: { runs: RunOption[] }) {
  const router = useRouter();
  const dialog = useFormDialog();
  const { run, pending } = useRun();
  const [loading, startLoad] = useTransition();
  const [runId, setRunId] = useState("");
  const [clientId, setClientId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  const choose = (id: string) => {
    setRunId(id);
    setClientId("");
    setPreview(null);
    if (!id) return;
    startLoad(async () => {
      try {
        const r = await previewInvoiceRun({ runId: id });
        if (!r.ok) return void toast.error(r.error);
        setPreview(r.data);
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  };

  const client = preview?.clients.find((c) => c.clientId === clientId) ?? null;
  const blocked = !client || client.rate === null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createInvoice({ runId, clientId }),
          (d) => (d ? `Invoice ${d.number} made.` : "Invoice made."),
          (d) => {
            dialog?.close(true);
            if (d?.invoiceId) router.push(`/invoices/${d.invoiceId}`);
          },
        );
      }}
    >
      <p className="text-sm text-muted-foreground">
        An invoice bills one client for one pay run: the client payroll hours of each person, times the client&apos;s hourly rate in US dollars. It is a snapshot; later changes to hours or rates do not change it.
      </p>
      <div className="space-y-1">
        <Label htmlFor="invoice-run">Pay run</Label>
        <NativeSelect id="invoice-run" value={runId} onChange={(e) => choose(e.target.value)} required>
          <option value="">Choose a pay run</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Looking up the hours...</p> : null}
      {preview ? (
        <>
          {preview.status === "draft" ? <Alert variant="warning">This pay run is still a draft. The invoice will say DRAFT.</Alert> : null}
          {preview.clients.length === 0 ? (
            <Alert variant="muted">
              {preview.noHours.length > 0
                ? `Nothing to invoice yet: these people have a client but no client payroll hours on this run: ${preview.noHours.join(", ")}. Hours are typed on the pay run (Actions, then Amounts, or the Jibble timesheet import) while it is a draft. If the run is already in review, the Approver sends it back first.`
                : "Nothing to invoice: no person on this run has client payroll hours."}
            </Alert>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="invoice-client">Client</Label>
              <NativeSelect id="invoice-client" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
                <option value="">Choose a client</option>
                {preview.clients.map((c) => (
                  <option key={c.clientId} value={c.clientId}>
                    {c.clientName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {client ? (
            <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">People</dt>
                <dd className="tabular-nums">{client.people}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Hours</dt>
                <dd className="tabular-nums">{client.hours}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Rate per hour</dt>
                <dd className="tabular-nums">{client.rate === null ? "None yet" : `${client.rate} USD`}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total</dt>
                <dd className="tabular-nums">{client.total === null ? "-" : `${client.total} USD`}</dd>
              </div>
            </dl>
          ) : null}
          {client && client.rate === null ? <Alert variant="destructive">{client.clientName} has no billing rate yet. Add one on the Billing rates tab first.</Alert> : null}
          {client && client.unconfirmedLines > 0 ? (
            <Alert variant="warning">
              {client.unconfirmedLines} {client.unconfirmedLines === 1 ? "line uses" : "lines use"} suggested hours that {client.unconfirmedLines === 1 ? "is" : "are"} not confirmed yet. The invoice will say so.
            </Alert>
          ) : null}
          {client && client.existing > 0 ? <Alert variant="info">An invoice for this run and client already exists. This one will be a revision (R{client.existing + 1}).</Alert> : null}
          {preview.noClient.length > 0 ? (
            <Alert variant="muted">
              No client, not invoiced: {preview.noClient.join(", ")}.
            </Alert>
          ) : null}
        </>
      ) : null}
      <Button type="submit" disabled={pending || blocked}>
        Make invoice
      </Button>
    </form>
  );
}

export function NewInvoiceDialog({ runs }: { runs: RunOption[] }) {
  return (
    <FormDialog label="New invoice" title="New invoice" icon={<Plus className="size-4" aria-hidden />}>
      <NewInvoiceForm runs={runs} />
    </FormDialog>
  );
}

function AddRateForm({ clients, today, clientId: fixed }: { clients: { id: string; name: string }[]; today: string; clientId?: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [clientId, setClientId] = useState(fixed ?? "");
  const [effectiveFrom, setFrom] = useState(today);
  const [rate, setRate] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addBillRate({ clientId, effectiveFrom, rate }), "Rate added.", () => dialog?.close(true));
      }}
    >
      <p className="text-sm text-muted-foreground">
        The rate is what we bill the client for one hour, in US dollars. An invoice uses the newest rate that started on or before the day it is made. Earlier rates stay in the history.
      </p>
      <div className="space-y-1">
        <Label htmlFor="rate-client">Client</Label>
        <NativeSelect id="rate-client" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
          <option value="">Choose a client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="rate-from">Starts on</Label>
          <Input id="rate-from" type="date" value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rate-amount">Rate per hour (USD)</Label>
          <Input id="rate-amount" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="25.50" required />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        Add rate
      </Button>
    </form>
  );
}

export function AddRateDialog({ clients, today }: { clients: { id: string; name: string }[]; today: string }) {
  return (
    <FormDialog label="Add rate" title="Add a billing rate" icon={<Plus className="size-4" aria-hidden />}>
      <AddRateForm clients={clients} today={today} />
    </FormDialog>
  );
}
