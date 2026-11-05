import { PAYSLIP_LABELS as L } from "../constants";
import type { PayslipLineView, PayslipRowView, PayslipView } from "../payslip";

// The payslip on screen: the same content as the PDF (both draw from payslipView), laid out like a page of paper. A server component, no
// script: it works the same with or without a PDF viewer in the browser.

function Rows({ rows }: { rows: PayslipRowView[] }) {
  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={`${row.label}-${row.detail}`} className="flex items-baseline justify-between gap-4 py-2 text-sm">
          <span>
            {row.label}
            {row.detail ? <span className="block text-xs text-muted-foreground">{row.detail}</span> : null}
          </span>
          <span className="shrink-0 tabular-nums">{row.amount}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, rows }: { title: string; rows: PayslipRowView[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <Rows rows={rows} />
    </section>
  );
}

function Line({ line }: { line: PayslipLineView }) {
  return (
    <div className="space-y-4">
      {line.heading ? <h2 className="text-base font-semibold">{line.heading}</h2> : null}
      <Section title={L.earnings} rows={line.earnings} />
      <div className="flex items-baseline justify-between gap-4 border-y bg-muted/40 px-3 py-2 text-sm font-semibold">
        <span>{L.gross}</span>
        <span className="tabular-nums">{line.gross}</span>
      </div>
      <Section title={L.additions} rows={line.additions} />
      <Section title={L.deductions} rows={line.deductions} />
      <div className="flex items-baseline justify-between gap-4 rounded-lg bg-primary px-4 py-3 text-primary-foreground">
        <span className="text-sm font-semibold">{L.net}</span>
        <span className="text-xl font-semibold tabular-nums">{line.net}</span>
      </div>
    </div>
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

      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label={L.preparedFor} value={view.name} />
        <Fact label={L.period} value={view.period} />
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
        <p className="text-xs text-muted-foreground">{L.footerNote}</p>
      </footer>
    </article>
  );
}
