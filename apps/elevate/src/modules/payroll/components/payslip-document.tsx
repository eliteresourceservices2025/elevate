import { Alert } from "@/components/ui/alert";
import { PAYSLIP_LABELS as L } from "../constants";
import type { PayslipLineView, PayslipRowView, PayslipView } from "../payslip";

// The Contractor Payment Statement on screen: the same content as the PDF (both draw from payslipView), laid out like a page of paper.
// Compensation on the left, deductions on the right, and every row is always listed (a dash when it is zero), so a contractor sees
// everything that could be paid or deducted. A server component, no script.

function Row({ row }: { row: PayslipRowView }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-foreground/10 px-3 py-1.5 text-sm last:border-b-0">
      <span>
        {row.label}
        {row.detail ? <span className="block text-xs text-muted-foreground">{row.detail}</span> : null}
      </span>
      <span className="shrink-0 tabular-nums">{row.amount}</span>
    </li>
  );
}

function Column({ title, rows, totalLabel, total }: { title: string; rows: PayslipRowView[]; totalLabel: string; total: string }) {
  return (
    <section className="flex flex-col">
      <h3 className="border-b border-foreground/30 bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">{title}</h3>
      <ul className="flex-1">
        {rows.map((row, index) => (
          <Row key={`${row.label}-${row.detail}-${index}`} row={row} />
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-4 border-t border-foreground/30 bg-muted/50 px-3 py-2 text-sm font-semibold">
        <span>{totalLabel}</span>
        <span className="tabular-nums">{total}</span>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

function Line({ line }: { line: PayslipLineView }) {
  return (
    <div className="space-y-4">
      {line.heading ? <h2 className="text-base font-semibold">{line.heading}</h2> : null}
      {line.client ? (
        <dl>
          <Fact label={L.client} value={line.client} />
        </dl>
      ) : null}

      <section className="space-y-1" aria-label={L.computationTitle}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L.computationTitle}</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          {line.computation.map((row) => (
            <div key={row.label}>
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="tabular-nums">{row.amount}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid overflow-hidden rounded-lg border border-foreground/30 md:grid-cols-2 md:divide-x md:divide-foreground/30">
        <Column title={L.compensationTitle} rows={line.compensation} totalLabel={L.totalCompensation} total={line.totalCompensation} />
        <Column title={L.deductionsTitle} rows={line.deductions} totalLabel={L.totalDeductions} total={line.totalDeductions} />
      </div>

      <section className="space-y-1" aria-label={L.leaveTitle}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L.leaveTitle}</h3>
        <dl className="grid grid-cols-3 gap-x-6 text-sm">
          {line.leave.map((row) => (
            <div key={row.label}>
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="tabular-nums">{row.amount}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex items-baseline justify-between gap-4 rounded-lg bg-primary px-4 py-3 text-primary-foreground">
        <span className="text-sm font-semibold">{L.net}</span>
        <span className="text-xl font-semibold tabular-nums">{line.net}</span>
      </div>
    </div>
  );
}

export function PayslipDocument({ view }: { view: PayslipView }) {
  const signature = view.signature;
  return (
    <article className="space-y-6 rounded-xl border bg-card p-5 text-card-foreground shadow-sm sm:p-8" aria-label={L.pageHeading(view.period)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-primary pb-4">
        <div className="flex items-center gap-3">
          {/* The ELEVATE logo from public/: a fixed small image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/elite-logo-icon.png" alt="" width={32} height={32} className="size-8" />
          <span className="font-heading text-base font-semibold text-primary">Elite Resource Services</span>
        </div>
        <div className="text-right">
          <p className="font-heading text-xl font-semibold uppercase tracking-wide">{view.title}</p>
          <p className="text-xs text-muted-foreground">
            {L.number} {view.number}
          </p>
        </div>
      </header>

      {view.isTest ? <Alert variant="destructive">{L.testNote}</Alert> : null}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label={L.preparedFor} value={view.name} />
        <Fact label={L.period} value={view.period} />
        {view.hiredOn ? <Fact label={L.hiredOn} value={view.hiredOn} /> : null}
        {view.paidOn ? <Fact label={L.paidOn} value={view.paidOn} /> : null}
        {view.paidBy ? <Fact label={L.paidBy} value={view.paidBy} /> : null}
      </dl>

      <div className="space-y-8">
        {view.lines.map((line, index) => (
          <Line key={index} line={line} />
        ))}
      </div>

      {view.total ? (
        <div className="flex items-baseline justify-between gap-4 rounded-lg border-2 border-primary px-4 py-3">
          <span className="text-sm font-semibold">{L.total}</span>
          <span className="text-xl font-semibold tabular-nums">{view.total}</span>
        </div>
      ) : null}

      <footer className="space-y-4 pt-4">
        <div className="max-w-xs space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{L.signedBy}</p>
          <div className="flex h-16 items-end border-b border-foreground/60 pb-1">
            {signature?.imageBase64 ? (
              // A private picture kept with the run, shown as a data URL: not a file Next.js can optimise.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/jpeg;base64,${signature.imageBase64}`} alt="" className="max-h-14 w-auto bg-white" />
            ) : null}
          </div>
          {signature ? (
            <>
              <p className="text-sm font-semibold">{signature.name}</p>
              <p className="text-sm">{signature.title}</p>
              <p className="text-xs text-muted-foreground">
                {L.signedOn} {signature.signedOn}
              </p>
            </>
          ) : (
            <p className="text-sm italic text-muted-foreground">{L.notSigned}</p>
          )}
        </div>
        <section className="space-y-3" aria-label={L.certificationTitle}>
          <h3 className="text-xs font-semibold uppercase tracking-wide">{L.certificationTitle}</h3>
          <p className="text-xs">{L.certificationText}</p>
          <div className="grid gap-4 pt-2 sm:grid-cols-3">
            {[L.preparedBy, L.certDate, L.contractorSignature].map((label) => (
              <div key={label}>
                <div className="h-8 border-b border-foreground/60" />
                <p className="pt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="space-y-1" aria-label={L.disclaimerTitle}>
          <h3 className="text-xs font-semibold uppercase tracking-wide">{L.disclaimerTitle}</h3>
          <p className="text-xs text-muted-foreground">{L.disclaimerText}</p>
        </section>
        <p className="text-xs text-muted-foreground">{L.noTax}</p>
        <p className="text-xs text-muted-foreground">{L.footerNote}</p>
      </footer>
    </article>
  );
}
