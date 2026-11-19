"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HintedLabel } from "@/components/field-hint";
import { PAYROLL_HINTS } from "../hints";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRun } from "@/modules/recruiting/components/use-run";
import { exportRemitlyList, markPaid } from "../actions";
import { PAYMENT_LABELS as P } from "../constants";
import { DEFAULT_PAYMENT_SORT, nextSort, PAYMENT_SORT_CHOICES, sortPayments, type PaymentSort, type PaymentSortKey } from "../payment-sort";
import { quickDates, whenLabel } from "../payment-when";
import type { PaymentsView } from "../queries";

type Now = { date: string; time: string };

/** Today, tomorrow and next Tuesday beside a date box: one tap instead of the calendar. */
function QuickDates({ from, onPick }: { from: string; onPick: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {quickDates(from).map((q) => (
        <Button key={q.label} type="button" size="sm" variant="outline" onClick={() => onPick(q.value)}>
          {q.label}
        </Button>
      ))}
    </div>
  );
}

/** Cents as typed in the box ("351.66"), for a payment that is being corrected. */
const typedUsd = (cents: string | null): string => (cents === null || BigInt(cents) < 0n ? "" : `${BigInt(cents) / 100n}.${(BigInt(cents) % 100n).toString().padStart(2, "0")}`);

/** A column title that sorts the table: it names the direction for assistive tools, and shows it with an arrow. */
function SortTitle({ label, sortKey, sort, onSort }: { label: string; sortKey: PaymentSortKey; sort: PaymentSort; onSort: (key: PaymentSortKey) => void }) {
  const active = sort.key === sortKey;
  const Arrow = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      {label}
      <Arrow className={active ? "size-3.5" : "size-3.5 text-muted-foreground"} aria-hidden />
    </button>
  );
}

// Paying an approved run: the Remitly list, and one reference per person. The server decides everything (approval, who is on the run);
// this panel only offers what makes sense.

function MarkPaidForm({
  runId,
  employeeId,
  current,
  currentUsd,
  usdUnreadable,
  currentSent,
  currentExpected,
  now,
}: {
  runId: string;
  employeeId: string;
  current: string;
  /** The dollars recorded with the payment being corrected, as typed ("351.66"); blank when none. */
  currentUsd: string;
  /** The dollars saved with this payment can't be read: saving would replace them. */
  usdUnreadable: boolean;
  /** The dates of the payment being corrected, or null for a new one (the form then starts at the time now in Manila). */
  currentSent: { date: string; time: string | null } | null;
  currentExpected: { date: string; time: string | null } | null;
  now: Now;
}) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [reference, setReference] = useState(current);
  const [paidOn, setPaidOn] = useState(currentSent?.date ?? now.date);
  const [sentTime, setSentTime] = useState(currentSent ? (currentSent.time ?? "") : now.time);
  const [expectedOn, setExpectedOn] = useState(currentExpected?.date ?? "");
  const [expectedTime, setExpectedTime] = useState(currentExpected?.time ?? "");
  const [usd, setUsd] = useState(currentUsd);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => markPaid({ runId, employeeId, reference, paidOn, sentTime, expectedOn, expectedTime, amountUsd: usd }),
          P.marked,
          () => dialog?.close(true),
        );
      }}
    >
      <div className="space-y-1">
        <HintedLabel htmlFor={`ref-${employeeId}`} hint={PAYROLL_HINTS.paymentReference}>{P.reference}</HintedLabel>
        <Input
          id={`ref-${employeeId}`}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={100}
          required
          autoComplete="off"
        />
      </div>
      <div className="space-y-1">
        <HintedLabel htmlFor={`paid-${employeeId}`} hint={PAYROLL_HINTS.paymentPaidOn}>{P.paidOn}</HintedLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Input id={`paid-${employeeId}`} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required className="w-auto" />
          <Input id={`sent-time-${employeeId}`} type="time" aria-label={P.sentTime} title={PAYROLL_HINTS.paymentSentTime} value={sentTime} onChange={(e) => setSentTime(e.target.value)} className="w-auto" />
          <span className="text-xs text-muted-foreground">PHT</span>
        </div>
        <QuickDates from={now.date} onPick={setPaidOn} />
      </div>
      <div className="space-y-1">
        <HintedLabel htmlFor={`expected-${employeeId}`} hint={PAYROLL_HINTS.paymentExpected}>{P.expectedOn}</HintedLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Input id={`expected-${employeeId}`} type="date" value={expectedOn} min={paidOn} onChange={(e) => setExpectedOn(e.target.value)} className="w-auto" />
          <Input id={`expected-time-${employeeId}`} type="time" aria-label={P.expectedTime} value={expectedTime} onChange={(e) => setExpectedTime(e.target.value)} disabled={!expectedOn} className="w-auto" />
          <span className="text-xs text-muted-foreground">PHT</span>
          {expectedOn ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => { setExpectedOn(""); setExpectedTime(""); }}>
              Clear
            </Button>
          ) : null}
        </div>
        <QuickDates from={paidOn || now.date} onPick={setExpectedOn} />
      </div>
      <div className="space-y-1">
        <HintedLabel htmlFor={`usd-${employeeId}`} hint={PAYROLL_HINTS.paymentUsd}>{P.amountUsd}</HintedLabel>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground" aria-hidden>
            $
          </span>
          <Input id={`usd-${employeeId}`} inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="351.66" autoComplete="off" />
        </div>
        {usdUnreadable ? <p className="text-xs text-warning">{P.usdUnreadableWarning}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>
        {P.markPaid}
      </Button>
    </form>
  );
}

export function PaymentsPanel({ view, now }: { view: PaymentsView; now: Now }) {
  const { run, pending } = useRun();
  const paid = view.people.filter((p) => p.payment !== null).length;
  const [sort, setSort] = useState<PaymentSort>(DEFAULT_PAYMENT_SORT);
  const people = useMemo(() => sortPayments(view.people, sort), [view.people, sort]);
  // The dollars column is for the people who can read what was recorded (the same people who read the references).
  const showUsd = view.canMarkPaid;
  const someUnreadable = showUsd && view.people.some((p) => p.payment?.usd === P.usdUnreadable);
  const ariaSort = (key: PaymentSortKey) => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");

  const download = () =>
    run<{ fileName: string; csv: string; rows: number; missingDetails: number; test: boolean }>(
      async () => {
        const result = await exportRemitlyList({ runId: view.runId });
        if (result.ok) {
          const url = URL.createObjectURL(
            new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = result.data.fileName;
          a.click();
          URL.revokeObjectURL(url);
        }
        return result;
      },
      (d) => `${P.downloaded(d?.rows ?? 0)}${d && d.missingDetails > 0 ? ` ${P.missingDetails(d.missingDetails)}` : ""}`,
    );

  return (
    <section aria-label={P.title} className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{P.title}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {P.progress(paid, view.people.length)}
            {view.usdTotal ? ` · ${P.usdTotal(view.usdTotal)}` : ""}
            {someUnreadable ? ` · ${P.usdSomeUnreadable}` : ""}
          </span>
          {view.canExport ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={download}
            >
              <Download className="size-4" aria-hidden />
              {P.download}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{P.hint}</p>
      {view.isTest ? (
        <Alert variant="warning" className="rounded-lg p-3 text-sm">
          {P.testBanner}
        </Alert>
      ) : null}
      {view.status === "paid" ? (
        <Alert variant="success" className="rounded-lg p-3 text-sm">
          {P.allPaid}
        </Alert>
      ) : null}
      <div className="flex items-center gap-2 md:hidden">
        <Label htmlFor="payment-sort" className="text-sm">
          {P.sortBy}
        </Label>
        <NativeSelect
          id="payment-sort"
          className="w-auto"
          value={`${sort.key}:${sort.dir}`}
          onChange={(e) => setSort(PAYMENT_SORT_CHOICES.find((c) => c.value === e.target.value)?.sort ?? DEFAULT_PAYMENT_SORT)}
        >
          {PAYMENT_SORT_CHOICES.filter((c) => showUsd || c.sort.key !== "usd").map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Table stack stickyHeader>
        <TableHeader>
          <TableRow>
            <TableHead aria-sort={ariaSort("name")}>
              <SortTitle label={P.person} sortKey="name" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
            </TableHead>
            <TableHead aria-sort={ariaSort("client")}>
              <SortTitle label={P.client} sortKey="client" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
            </TableHead>
            <TableHead aria-sort={ariaSort("status")}>
              <SortTitle label={P.status} sortKey="status" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
            </TableHead>
            <TableHead>{P.reference}</TableHead>
            {showUsd ? (
              <TableHead aria-sort={ariaSort("usd")}>
                <SortTitle label={P.usd} sortKey="usd" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              </TableHead>
            ) : null}
            <TableHead>
              <span className="sr-only">{P.actions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map((p) => (
            <TableRow key={p.employeeId}>
              <TableCell label={P.person} className="font-medium">
                {p.name}
              </TableCell>
              <TableCell label={P.client}>{p.clients || P.none}</TableCell>
              <TableCell label={P.status}>
                {p.payment ? (
                  <div className="space-y-1">
                    <Badge variant="success">{`${P.paid} ${whenLabel(p.payment.paidOn, p.payment.sentTime)}`}</Badge>
                    {p.payment.expectedOn ? <p className="text-xs text-muted-foreground">{P.expected(whenLabel(p.payment.expectedOn, p.payment.expectedTime))}</p> : null}
                  </div>
                ) : (
                  <Badge variant="outline">{P.notPaid}</Badge>
                )}
              </TableCell>
              <TableCell label={P.reference} className="font-mono text-xs">
                {p.payment
                  ? (p.payment.reference ?? (
                      <span className="font-sans text-muted-foreground">
                        {P.markedBy(p.payment.markedBy)}
                      </span>
                    ))
                  : P.none}
              </TableCell>
              {showUsd ? (
                <TableCell label={P.usd} className="tabular-nums">
                  {p.payment?.usd ?? P.none}
                </TableCell>
              ) : null}
              <TableCell label={P.actions}>
                {view.canMarkPaid ? (
                  <FormDialog
                    label={p.payment ? P.correct : P.markPaid}
                    title={p.payment ? P.correctTitle(p.name) : P.markPaidTitle(p.name)}
                    variant="outline"
                  >
                    <MarkPaidForm
                      runId={view.runId}
                      employeeId={p.employeeId}
                      current={p.payment?.reference ?? ""}
                      currentUsd={typedUsd(p.payment?.usdCents ?? null)}
                      usdUnreadable={p.payment?.usd === P.usdUnreadable}
                      currentSent={p.payment ? { date: p.payment.paidOn, time: p.payment.sentTime } : null}
                      currentExpected={p.payment?.expectedOn ? { date: p.payment.expectedOn, time: p.payment.expectedTime } : null}
                      now={now}
                    />
                  </FormDialog>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
