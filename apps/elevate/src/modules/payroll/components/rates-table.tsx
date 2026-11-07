"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { ClientPager, usePaged } from "@/components/client-pager";
import { EmptyState } from "@/components/empty-state";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { createPayLine, endPayLine, updatePayLine } from "../actions";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, RATES_LABELS as L, UNREADABLE_HINT, unreadableNotice, type PaymentMethod } from "../constants";
import type { RateOptions, RateRow } from "../queries";

type Fields = {
  clientId: string;
  alias: string;
  hoursPerDay: string;
  paymentMethod: PaymentMethod;
  effectiveFrom: string;
  monthly: string;
};

const blank = (today: string): Fields => ({
  clientId: "",
  alias: "",
  hoursPerDay: "8",
  paymentMethod: "remitly",
  effectiveFrom: today,
  monthly: "",
});

function LineFields({ value, onChange, clients, idPrefix }: { value: Fields; onChange: (next: Fields) => void; clients: RateOptions["clients"]; idPrefix: string }) {
  const set = <K extends keyof Fields>(key: K, v: Fields[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-client`}>{L.client} (optional)</Label>
        <NativeSelect id={`${idPrefix}-client`} value={value.clientId} onChange={(e) => set("clientId", e.target.value)}>
          <option value="">No client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-alias`}>{L.alias} (optional)</Label>
        <Input id={`${idPrefix}-alias`} value={value.alias} onChange={(e) => set("alias", e.target.value)} maxLength={80} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-hours`}>{L.hoursPerDay}</Label>
        <Input id={`${idPrefix}-hours`} type="number" inputMode="numeric" min={1} max={12} step={1} value={value.hoursPerDay} onChange={(e) => set("hoursPerDay", e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-monthly`}>{L.monthly}</Label>
        <Input id={`${idPrefix}-monthly`} inputMode="decimal" value={value.monthly} onChange={(e) => set("monthly", e.target.value)} placeholder="25,000.00" autoComplete="off" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-method`}>{L.paymentMethod}</Label>
        <NativeSelect id={`${idPrefix}-method`} value={value.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-from`}>{L.startsOn}</Label>
        <Input id={`${idPrefix}-from`} type="date" value={value.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} required />
      </div>
    </div>
  );
}

const common = (v: Fields) => ({
  clientId: v.clientId,
  alias: v.alias,
  hoursPerDay: Number(v.hoursPerDay),
  paymentMethod: v.paymentMethod,
  effectiveFrom: v.effectiveFrom,
  monthly: v.monthly,
});

function AddLineForm({ options, today }: { options: RateOptions; today: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [employeeId, setEmployeeId] = useState("");
  const [fields, setFields] = useState<Fields>(blank(today));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createPayLine({ employeeId, ...common(fields) }), "Pay line added.", () => dialog?.close(true));
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="add-person">{L.person}</Label>
        <NativeSelect id="add-person" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
          <option value="">Choose a person</option>
          {options.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <LineFields value={fields} onChange={setFields} clients={options.clients} idPrefix="add" />
      <Button type="submit" disabled={pending}>
        Add pay line
      </Button>
    </form>
  );
}

function ChangeLineForm({ row, options, today }: { row: RateRow; options: RateOptions; today: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [fields, setFields] = useState<Fields>({
    clientId: row.clientId ?? "",
    alias: row.alias ?? "",
    hoursPerDay: String(row.hoursPerDay),
    paymentMethod: row.paymentMethod,
    effectiveFrom: today,
    monthly: row.monthly,
  });
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updatePayLine({ lineKey: row.lineKey, ...common(fields), reason }), "New version saved.", () => dialog?.close(true));
      }}
    >
      <LineFields value={fields} onChange={setFields} clients={options.clients} idPrefix={`chg-${row.lineKey}`} />
      <div className="space-y-1">
        <Label htmlFor={`chg-${row.lineKey}-reason`}>{L.reasonForChange}</Label>
        <Textarea id={`chg-${row.lineKey}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} required />
        <p className="text-xs text-muted-foreground">Kept in the change history, never in notices.</p>
      </div>
      <Button type="submit" disabled={pending}>
        Save new version
      </Button>
    </form>
  );
}

function EndLineForm({ row, today }: { row: RateRow; today: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [endsOn, setEndsOn] = useState(today);
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => endPayLine({ lineKey: row.lineKey, endsOn, reason }), "Pay line ended.", () => dialog?.close(true));
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`end-${row.lineKey}-date`}>{L.lastDay}</Label>
        <Input id={`end-${row.lineKey}-date`} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`end-${row.lineKey}-reason`}>{L.reason}</Label>
        <Textarea id={`end-${row.lineKey}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} required />
      </div>
      <Button type="submit" variant="destructive" disabled={pending}>
        End pay line
      </Button>
    </form>
  );
}

export function RatesTable({ rows, options, today }: { rows: RateRow[]; options: RateOptions | null; today: string }) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = rows.filter((r) => `${r.name} ${r.clientName ?? ""} ${r.alias ?? ""}`.toLowerCase().includes(needle));
  const paged = usePaged(shown, filter);

  return (
    <div className="space-y-4">
      <Alert variant="info" role="note" className="rounded-lg p-3 text-sm">
        These are pay figures. Opening this page is written to the audit log. A change is a new version with a start date, and the old one stays on record.
      </Alert>
      {rows.some((r) => r.unreadable) ? (
        <Alert variant="warning" role="alert" className="rounded-lg p-3 text-sm">
          {unreadableNotice(rows.filter((r) => r.unreadable).length)}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label htmlFor="rates-filter" className="text-xs">
            Find a person, client or alias
          </Label>
          <Input id="rates-filter" className="h-8 w-64" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {options ? (
          <FormDialog label="Add pay line" title="Add a pay line" description="One line per person and role. Someone working for two clients has two lines." icon={<Plus className="size-4" aria-hidden />} size="lg">
            <AddLineForm options={options} today={today} />
          </FormDialog>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No pay lines yet" description={options ? "Add a line for each person you pay." : "A Preparer adds the pay lines."} />
      ) : (
        <>
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>{L.person}</TableHead>
                <TableHead>{L.clientShort}</TableHead>
                <TableHead>{L.aliasShort}</TableHead>
                <TableHead>{L.hoursPerDay}</TableHead>
                <TableHead>{L.monthly}</TableHead>
                <TableHead>{L.starts}</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((row) => (
                <TableRow key={row.lineKey}>
                  <TableCell label={L.person} className="font-medium">
                    {row.name}
                  </TableCell>
                  <TableCell label={L.clientShort}>{row.clientName ?? "None"}</TableCell>
                  <TableCell label={L.aliasShort}>{row.alias ?? "None"}</TableCell>
                  <TableCell label={L.hoursPerDay}>{row.hoursPerDay}</TableCell>
                  <TableCell label={L.monthly} className="tabular-nums">
                    {row.monthly}
                  </TableCell>
                  <TableCell label={L.starts}>
                    {row.effectiveFrom}
                    {row.upcomingFrom ? <span className="block text-xs text-muted-foreground">Next change {row.upcomingFrom}</span> : null}
                    {row.endsOn ? <span className="block text-xs text-muted-foreground">Ends {row.endsOn}</span> : null}
                  </TableCell>
                  <TableCell label="Actions">
                    {options && !row.isOwn ? (
                      <div className="flex flex-wrap gap-2">
                        {row.endsOn ? null : (
                          <>
                            <FormDialog label="Change" title={`Change ${row.name}'s pay line`} description="Saved as a new version with its own start date." variant="outline" triggerSize="sm" size="lg" disabled={row.unreadable} hint={UNREADABLE_HINT}>
                              <ChangeLineForm row={row} options={options} today={today} />
                            </FormDialog>
                            <FormDialog label="End" title={`End ${row.name}'s pay line`} description="The line stays on record. It stops being paid after the last day." variant="outline" triggerSize="sm">
                              <EndLineForm row={row} today={today} />
                            </FormDialog>
                          </>
                        )}
                      </div>
                    ) : row.isOwn ? (
                      <span className="text-xs text-muted-foreground">Your own line. Another Preparer changes it.</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="pay lines" />
        </>
      )}
    </div>
  );
}
