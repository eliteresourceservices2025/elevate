import { Alert } from "@/components/ui/alert";
import type { InvoiceText } from "../invoice-text";

// The invoice on screen: the same content as the PDF (both draw from invoiceText). A server component, no script.

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export function InvoiceDocument({ view }: { view: InvoiceText }) {
  return (
    <article className="space-y-6 rounded-xl border bg-card p-5 text-card-foreground shadow-sm sm:p-8" aria-label={`Invoice ${view.number}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-primary pb-4">
        <div className="flex items-center gap-3">
          {/* The ELEVATE logo from public/: a fixed small image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/elite-logo-icon.png" alt="" width={32} height={32} className="size-8" />
          <span className="font-heading text-base font-semibold text-primary">Elite Resource Services</span>
        </div>
        <div className="text-right">
          <p className="font-heading text-xl font-semibold uppercase tracking-wide">Invoice</p>
          <p className="text-xs text-muted-foreground">{view.number}</p>
        </div>
      </header>

      {view.isTest ? <Alert variant="destructive">{view.testNote}</Alert> : null}
      {view.isDraft ? <Alert variant="warning">{view.draftNote}</Alert> : null}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Bill to" value={view.clientName} />
        <Fact label="Period" value={view.period} />
        <Fact label="Date" value={view.issuedOn} />
        <Fact label="Rate per hour" value={`${view.rate} ${view.currency}`} />
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/30 bg-muted/50 text-left text-xs uppercase tracking-wide">
              <th scope="col" className="px-3 py-2 font-semibold">Person</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Hours</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Rate ({view.currency})</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Amount ({view.currency})</th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((l, i) => (
              <tr key={`${l.name}-${i}`} className="border-b border-foreground/10">
                <td className="px-3 py-1.5">{l.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.hours}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.rate}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.amount}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-foreground/30 bg-muted/50 font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{view.totalHours}</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tabular-nums">{view.total}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-baseline justify-between gap-4 rounded-lg border-2 border-primary px-4 py-3">
        <span className="text-sm font-semibold">Total due ({view.currency})</span>
        <span className="text-xl font-semibold tabular-nums">{view.total}</span>
      </div>

      {view.unconfirmed ? <Alert variant="warning">{view.unconfirmed}</Alert> : null}
      <p className="text-xs text-muted-foreground">All amounts are in US dollars ({view.currency}). Hours are the client payroll hours of the pay run for the period.</p>
    </article>
  );
}
