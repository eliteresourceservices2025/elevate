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
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { exportRemitlyList, markPaid, skipPayment } from "../actions";
import { PAYMENT_LABELS as P } from "../constants";
import { DEFAULT_PAYMENT_SORT, nextSort, PAYMENT_SORT_CHOICES, sortPayments, type PaymentSort, type PaymentSortKey } from "../payment-sort";
import type { PaymentsView } from "../queries";

/** Cents as typed in the box ("351.66"), for a payment that is being corrected. */
const typedUsd = (cents: string | null): string => (cents === null || BigInt(cents) < 0n ? "" : `${BigInt(cents) / 100n}.${(BigInt(cents) % 100n).toString().padStart(2, "0")}`);

/** The date today in the company time zone, read when asked (a page left open overnight must not offer yesterday). */
const freshToday = () => formatInZone(Date.now(), DEFAULT_TIMEZONE, "yyyy-MM-dd");

/** Recording that a person could not be paid this time: the reason is required, and they count as handled. */
function SkipForm({ runId, employeeId }: { runId: string; employeeId: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => skipPayment({ runId, employeeId, reason }),
          P.skipped,
          () => dialog?.close(true),
        );
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`skip-${employeeId}`}>{P.skipReason}</Label>
        <Input id={`skip-${employeeId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required autoComplete="off" />
        <p className="text-xs text-muted-foreground">{P.skipHint}</p>
      </div>
      <Button type="submit" disabled={pending || reason.trim() === ""}>
        {P.skipSave}
      </Button>
    </form>
  );
}

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

// Paying an approved run: the Remitly list, and one reference per person. The server decides everything (approval, own pay, the date);
// this panel only offers what makes sense.

function MarkPaidForm({
  runId,
  employeeId,
  current,
  currentUsd,
  usdUnreadable,
  today,
  onSaved,
}: {
  runId: string;
  employeeId: string;
  current: string;
  /** The dollars recorded with the payment being corrected, as typed ("351.66"); blank when none. */
  currentUsd: string;
  /** The dollars saved with this payment can't be read: saving would replace them. */
  usdUnreadable: boolean;
  /** The date to start from: the last one used in this sitting, else today. */
  today: string;
  /** Called with the paid-on date once the payment is saved, so the next dialog starts from it. */
  onSaved: (paidOn: string) => void;
}) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [reference, setReference] = useState(current);
  const [paidOn, setPaidOn] = useState(today);
  const [usd, setUsd] = useState(currentUsd);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => markPaid({ runId, employeeId, reference, paidOn, amountUsd: usd }),
          P.marked,
          () => {
            onSaved(paidOn);
            dialog?.close(true);
          },
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
        <Input
          id={`paid-${employeeId}`}
          type="date"
          value={paidOn}
          max={freshToday()}
          onChange={(e) => setPaidOn(e.target.value)}
          required
        />
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

export function PaymentsPanel({ view }: { view: PaymentsView }) {
  const { run, pending } = useRun();
  const paid = view.people.filter((p) => p.payment !== null && !p.payment.skipped).length;
  const [sort, setSort] = useState<PaymentSort>(DEFAULT_PAYMENT_SORT);
  const [find, setFind] = useState("");
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [lastPaidOn, setLastPaidOn] = useState<string | null>(null);
  const needle = find.trim().toLowerCase();
  const people = useMemo(
    () =>
      sortPayments(view.people, sort).filter(
        (p) => (!onlyUnpaid || p.payment === null || p.payment.skipped) && (needle === "" || p.name.toLowerCase().includes(needle) || p.clients.toLowerCase().includes(needle)),
      ),
    [view.people, sort, find, onlyUnpaid], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const missingDetails = view.people.filter((p) => p.noPayoutDetails === true && (p.payment === null || p.payment.skipped)).length;
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
            {P.progress(paid, view.people.length, view.skippedCount)}
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
      {missingDetails > 0 ? (
        <Alert variant="warning" className="rounded-lg p-3 text-sm">
          {P.noDetailsWarning(missingDetails)}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1 space-y-1">
          <Label htmlFor="payment-find" className="sr-only">
            {P.search}
          </Label>
          <Input id="payment-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={P.search} autoComplete="off" />
        </div>
        <label className="flex min-h-8 items-center gap-2 text-sm pointer-coarse:min-h-11">
          <input type="checkbox" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} className="size-4" />
          {P.onlyUnpaid}
        </label>
      </div>
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
            {showUsd ? <TableHead>{P.pesos}</TableHead> : null}
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
          {people.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-sm text-muted-foreground">
                {P.noMatches}
              </TableCell>
            </TableRow>
          ) : null}
          {people.map((p) => (
            <TableRow key={p.employeeId}>
              <TableCell label={P.person} className="font-medium">
                {p.name}
              </TableCell>
              <TableCell label={P.client}>{p.clients || P.none}</TableCell>
              <TableCell label={P.status}>
                {p.payment?.skipped ? (
                  <Badge variant="warning">{P.skippedBadge}</Badge>
                ) : p.payment ? (
                  <Badge variant="success">{`${P.paid} ${p.payment.paidOn}`}</Badge>
                ) : (
                  <Badge variant="outline">{P.notPaid}</Badge>
                )}
                {p.noPayoutDetails && (!p.payment || p.payment.skipped) ? (
                  <Badge variant="destructive" className="ml-1">
                    {P.noDetails}
                  </Badge>
                ) : null}
              </TableCell>
              {showUsd ? (
                <TableCell label={P.pesos} className="tabular-nums">
                  {p.pesos ?? P.none}
                </TableCell>
              ) : null}
              <TableCell label={P.reference} className="font-mono text-xs">
                {p.payment?.skipped
                  ? p.payment.skipReason
                    ? <span className="font-sans text-muted-foreground">{P.skippedReason(p.payment.skipReason)}</span>
                    : <span className="font-sans text-muted-foreground">{P.markedBy(p.payment.markedBy)}</span>
                  : p.payment
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
                {view.canMarkPaid && !p.isOwn ? (
                  <div className="flex flex-wrap gap-2">
                  <FormDialog
                    label={p.payment && !p.payment.skipped ? P.correct : P.markPaid}
                    title={p.payment && !p.payment.skipped ? P.correctTitle(p.name) : P.markPaidTitle(p.name)}
                    variant="outline"
                  >
                    <MarkPaidForm
                      runId={view.runId}
                      employeeId={p.employeeId}
                      current={p.payment?.reference ?? ""}
                      currentUsd={typedUsd(p.payment?.usdCents ?? null)}
                      usdUnreadable={p.payment?.usd === P.usdUnreadable}
                      today={lastPaidOn ?? freshToday()}
                      onSaved={setLastPaidOn}
                    />
                  </FormDialog>
                  {!p.payment || p.payment.skipped ? (
                    <FormDialog label={P.skip} title={P.skipTitle(p.name)} variant="secondary">
                      <SkipForm runId={view.runId} employeeId={p.employeeId} />
                    </FormDialog>
                  ) : null}
                  </div>
                ) : p.isOwn && view.canMarkPaid ? (
                  <span className="text-xs text-muted-foreground">{P.ownLine}</span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
