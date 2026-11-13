"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HintedLabel } from "@/components/field-hint";
import { PAYROLL_HINTS } from "../hints";
import { Label } from "@/components/ui/label";
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
import type { PaymentsView } from "../queries";

// Paying an approved run: the Remitly list, and one reference per person. The server decides everything (approval, own pay, the date);
// this panel only offers what makes sense.

function MarkPaidForm({
  runId,
  employeeId,
  current,
  today,
}: {
  runId: string;
  employeeId: string;
  current: string;
  today: string;
}) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [reference, setReference] = useState(current);
  const [paidOn, setPaidOn] = useState(today);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => markPaid({ runId, employeeId, reference, paidOn }),
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
        <Input
          id={`paid-${employeeId}`}
          type="date"
          value={paidOn}
          max={today}
          onChange={(e) => setPaidOn(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {P.markPaid}
      </Button>
    </form>
  );
}

export function PaymentsPanel({ view, today }: { view: PaymentsView; today: string }) {
  const { run, pending } = useRun();
  const paid = view.people.filter((p) => p.payment !== null).length;

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
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>{P.person}</TableHead>
            <TableHead>{P.alias}</TableHead>
            <TableHead>{P.status}</TableHead>
            <TableHead>{P.reference}</TableHead>
            <TableHead>
              <span className="sr-only">{P.actions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.people.map((p) => (
            <TableRow key={p.employeeId}>
              <TableCell label={P.person} className="font-medium">
                {p.name}
              </TableCell>
              <TableCell label={P.alias}>{p.aliases || P.none}</TableCell>
              <TableCell label={P.status}>
                {p.payment ? (
                  <Badge variant="success">{`${P.paid} ${p.payment.paidOn}`}</Badge>
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
              <TableCell label={P.actions}>
                {view.canMarkPaid && !p.isOwn ? (
                  <FormDialog
                    label={p.payment ? P.correct : P.markPaid}
                    title={p.payment ? P.correctTitle(p.name) : P.markPaidTitle(p.name)}
                    variant="outline"
                  >
                    <MarkPaidForm
                      runId={view.runId}
                      employeeId={p.employeeId}
                      current={p.payment?.reference ?? ""}
                      today={today}
                    />
                  </FormDialog>
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
