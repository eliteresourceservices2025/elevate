import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Fragment } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXTRA_KEYS } from "../calculate";
import { EXTRA_KEY_ITEM, HISTORY_LABELS, PAY_ITEM_LABELS, WORKSHEET_LABELS as L } from "../constants";
import type { Worksheet, WorksheetFigures, WorksheetLine } from "../runs";
import { LineHashScroller } from "./go-to-line";
import { LineFlags } from "./line-flags";
import { LineActions } from "./line-actions";
import { ariaSortOf, SortHead, type SortLinks } from "./sort-head";
import { WorksheetColumns } from "./worksheet-columns";

// The sheet. Below the tablet width each person is a compact card (name, net, status, what needs attention) that opens to every figure,
// with the Actions menu always beside it. From the tablet width up it is a table with every column (Finance wants to see all items); unticking
// "Show every column" gives a short set. Name and client stay in view when the table scrolls sideways. Each person is drawn twice (card and row, one hidden), so the
// two copies have different ids (card-<id>, row-<id>); the readiness screen links to #line-<id> and go-to-line.tsx finds the visible one.

const FROZEN = "md:sticky z-10 bg-card";
const num = "text-right tabular-nums";
const head = "whitespace-normal align-bottom";
// Cells that only show under "Show every column" (the frame in worksheet-columns.tsx sets data-detail on an ancestor).
const D = "group-data-[detail=off]:hidden";

export type IssueCounts = Record<string, { must: number; review: number }>;

function Pending({ line }: { line: WorksheetLine }) {
  const suggested = line.items.filter((i) => i.state === "suggested").length;
  return suggested > 0 ? <span className="block text-xs text-muted-foreground">{suggested} suggested, not yet confirmed</span> : null;
}

/** Every figure of a line, in the order the pay is worked out, as label and value pairs (for the phone card). */
function figureRows(f: WorksheetFigures, hoursPerDay: number): [string, string][] {
  return [
    [L.hoursPerDay, String(hoursPerDay)],
    [L.monthly, f.monthly],
    [L.base, f.base],
    [L.absences, f.absences],
    [L.sickLeave, f.sickLeave],
    [L.late, f.late],
    ...EXTRA_KEYS.map((k): [string, string] => [PAY_ITEM_LABELS[EXTRA_KEY_ITEM[k]], f.extra[k]]),
    [L.bereavement, f.bereavementDays],
    [L.pto, f.ptoDays],
    [L.allowances, f.allowances],
    [L.gross, f.gross],
    [L.reimbursements, f.reimbursements],
    [L.bonuses, f.bonuses],
    [L.adjustments, f.adjustments],
    [L.loan, f.loan],
    [L.otherDeductions, f.otherDeductions],
    [L.clientHours, f.clientHours],
  ];
}

function PhoneCard({ line, runId, period, canActOnLines, correctableRuns, issues }: { line: WorksheetLine; runId: string; period: { start: string; end: string }; canActOnLines: boolean; correctableRuns: { id: string; label: string }[]; issues: { must: number; review: number } | undefined }) {
  const f = line.figures;
  return (
    <li id={`card-${line.runLineId}`} className="scroll-mt-24 rounded-lg border bg-card outline-none data-flash:ring-2 data-flash:ring-ring" data-line={line.name}>
      <details className="group/card">
        <summary className="flex min-h-14 cursor-pointer list-none items-start justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 space-y-1">
            <span className="block font-medium">{line.name}</span>
            <span className="block text-xs text-muted-foreground">
              {[line.alias, line.clientName ?? L.noClient].filter(Boolean).join(" · ")}
              {line.isOwn ? " · Your own line" : ""}
            </span>
            <span className="flex flex-wrap gap-1">
              {line.unreadable ? <Badge variant="destructive">{L.unreadable}</Badge> : null}
              {issues && issues.must > 0 ? <Badge variant="destructive">{issues.must} must fix</Badge> : null}
              {issues && issues.review > 0 ? <Badge variant="warning">{issues.review} to review</Badge> : null}
              {line.confirmedByName ? <Badge variant="success">Checked</Badge> : <Badge variant="outline">Not checked</Badge>}
            </span>
            <LineFlags runId={runId} line={line} period={period} canAct={canActOnLines} correctableRuns={correctableRuns} />
            <Pending line={line} />
          </span>
          <span className="flex shrink-0 items-start gap-1">
            <span className="text-right">
              <span className="block text-xs text-muted-foreground">Net</span>
              <span className="block text-base font-semibold tabular-nums">{line.unreadable || !f ? "-" : f.net}</span>
              {f?.netChange ? <span className="block text-xs text-muted-foreground tabular-nums">{f.netChange}</span> : null}
            </span>
            <ChevronDown className="mt-1 size-5 text-muted-foreground transition-transform group-open/card:rotate-180" aria-hidden />
          </span>
        </summary>
        {f && !line.unreadable ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t p-3 text-sm">
            {figureRows(f, line.hoursPerDay).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{L.confirmation}</dt>
              <dd>{line.confirmedByName ?? L.unconfirmed}</dd>
            </div>
          </dl>
        ) : null}
      </details>
      {canActOnLines ? (
        <div className="flex justify-end border-t p-2">
          <LineActions runId={runId} line={line} correctableRuns={correctableRuns} />
        </div>
      ) : null}
    </li>
  );
}

/** The heading for a client's people when the list is grouped by client, with the client's totals for the whole run (not just this page). */
function clientHeading(sheet: Worksheet, line: WorksheetLine): { name: string; facts: string | null } {
  const t = sheet.byClient?.find((c) => c.clientId === line.clientId);
  return {
    name: line.clientName ?? L.noClient,
    facts: t ? `${t.lines} ${t.lines === 1 ? "person" : "people"} · ${t.clientHours} client hours · total payable ${t.net}` : null,
  };
}

/** True for the first line of the page, and whenever the client changes from the line before. */
const startsGroup = (grouped: boolean, lines: WorksheetLine[], i: number) => grouped && (i === 0 || lines[i - 1].clientId !== lines[i].clientId);

export function Worksheet({
  sheet,
  lines,
  canPrepare,
  issueCounts = {},
  sortLinks,
  grouped = false,
}: {
  sheet: Worksheet;
  lines: WorksheetLine[];
  canPrepare: boolean;
  issueCounts?: IssueCounts;
  /** Where each sortable column title links to, and which way it points now. */
  sortLinks?: SortLinks;
  /** The list is grouped by client: a heading row for each client. */
  grouped?: boolean;
}) {
  const draft = sheet.run.status === "draft";
  const canActOnLines = canPrepare && draft;
  return (
    <div className="space-y-4">
      <LineHashScroller />
      <p className="text-sm">
        <Link href={`/payroll/history?run=${sheet.run.id}`} className="underline underline-offset-2">
          {HISTORY_LABELS.runHistory}
        </Link>
      </p>

      <ul className="space-y-2 md:hidden" aria-label="Pay lines">
        {lines.map((line, i) => (
          <Fragment key={line.runLineId}>
            {startsGroup(grouped, lines, i) ? (
              <li className="px-1 pt-2">
                <h3 className="text-sm font-semibold">{clientHeading(sheet, line).name}</h3>
                {clientHeading(sheet, line).facts ? <p className="text-xs text-muted-foreground">{clientHeading(sheet, line).facts}</p> : null}
              </li>
            ) : null}
            <PhoneCard line={line} runId={sheet.run.id} period={{ start: sheet.run.periodStart, end: sheet.run.periodEnd }} canActOnLines={canActOnLines} correctableRuns={sheet.correctableRuns} issues={issueCounts[line.runLineId]} />
          </Fragment>
        ))}
      </ul>

      <div className="hidden md:block">
        <WorksheetColumns>
          <p className="text-xs text-muted-foreground">Drag the table sideways to move across it, or hold Shift and use the mouse wheel.</p>
          <Table dragScroll scrollLabel="Pay run sheet. Drag sideways or use the arrow keys to scroll.">
            <TableHeader>
              <TableRow className={`${D} hover:bg-transparent`}>
                <TableHead colSpan={2} className={`${FROZEN} md:left-0 border-r`}>
                  {L.groups.person}
                </TableHead>
                <TableHead colSpan={3}>{L.groups.basis}</TableHead>
                <TableHead colSpan={3}>{L.groups.deductions}</TableHead>
                <TableHead colSpan={EXTRA_KEYS.length}>{L.groups.extra}</TableHead>
                <TableHead colSpan={2}>{L.groups.leave}</TableHead>
                <TableHead colSpan={2}>{L.groups.allowances}</TableHead>
                <TableHead colSpan={3}>{L.groups.additions}</TableHead>
                <TableHead colSpan={2}>{L.groups.loans}</TableHead>
                <TableHead colSpan={2}>{L.groups.result}</TableHead>
                <TableHead colSpan={1}>{L.groups.reference}</TableHead>
                <TableHead colSpan={2}>
                  <span className="sr-only">{L.actions}</span>
                </TableHead>
              </TableRow>
              <TableRow>
                <TableHead aria-sort={ariaSortOf(sortLinks, "name")} className={`${FROZEN} md:left-0 min-w-44`}>
                  <SortHead header="name" links={sortLinks}>
                    {L.person}
                  </SortHead>
                </TableHead>
                <TableHead aria-sort={ariaSortOf(sortLinks, "client")} className={`${FROZEN} md:left-44 min-w-36 border-r`}>
                  <SortHead header="client" links={sortLinks}>
                    {L.client}
                  </SortHead>
                </TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.hoursPerDay}</TableHead>
                <TableHead aria-sort={ariaSortOf(sortLinks, "rate")} className={`${head} ${num} ${D}`}>
                  <SortHead header="rate" links={sortLinks}>
                    {L.monthly}
                  </SortHead>
                </TableHead>
                <TableHead className={`${head} ${num}`}>{L.base}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.absences}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.sickLeave}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.late}</TableHead>
                {EXTRA_KEYS.map((k) => (
                  <TableHead key={k} className={`${head} ${num} min-w-28 ${D}`}>
                    {PAY_ITEM_LABELS[EXTRA_KEY_ITEM[k]]}
                  </TableHead>
                ))}
                <TableHead className={`${head} ${num} ${D}`}>{L.bereavement}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.pto}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.allowances}</TableHead>
                <TableHead className={`${head} ${num}`}>{L.gross}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.reimbursements}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.bonuses}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.adjustments}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.loan}</TableHead>
                <TableHead className={`${head} ${num} ${D}`}>{L.otherDeductions}</TableHead>
                <TableHead aria-sort={ariaSortOf(sortLinks, "net")} className={`${head} ${num}`}>
                  <SortHead header="net" links={sortLinks}>
                    {L.net}
                  </SortHead>
                </TableHead>
                <TableHead aria-sort={ariaSortOf(sortLinks, "change")} className={`${head} ${num}`}>
                  <SortHead header="change" links={sortLinks}>
                    {L.netChange}
                  </SortHead>
                </TableHead>
                <TableHead className={`${head} ${num}`}>{L.clientHours}</TableHead>
                <TableHead aria-sort={ariaSortOf(sortLinks, "checked")} className={head}>
                  <SortHead header="checked" links={sortLinks}>
                    {L.confirmation}
                  </SortHead>
                </TableHead>
                <TableHead className="md:sticky md:right-0 z-10 bg-card">
                  <span className="sr-only">{L.actions}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, rowIndex) => {
                const f = line.figures;
                const cell = (value: string | undefined, label: string, extra = "") => (
                  <TableCell label={label} className={`${num} ${extra}`}>
                    {line.unreadable || value === undefined ? "" : value}
                  </TableCell>
                );
                const heading = startsGroup(grouped, lines, rowIndex) ? clientHeading(sheet, line) : null;
                return (
                  <Fragment key={line.runLineId}>
                    {heading ? (
                      <TableRow className="bg-muted/60 hover:bg-muted/60" data-client-heading={heading.name}>
                        <TableCell colSpan={40} className="py-2">
                          <div className="sticky left-0 flex w-fit max-w-[calc(100vw-6rem)] flex-wrap items-baseline gap-x-3">
                            <span className="font-semibold">{heading.name}</span>
                            {heading.facts ? <span className="text-xs text-muted-foreground">{heading.facts}</span> : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  <TableRow id={`row-${line.runLineId}`} className="scroll-mt-24 outline-none data-flash:bg-muted data-flash:ring-2 data-flash:ring-inset data-flash:ring-ring">
                    <TableCell label={L.person} className={`${FROZEN} md:left-0 font-medium`}>
                      {line.name}
                      {line.alias ? <span className="block text-xs font-normal text-muted-foreground">{line.alias}</span> : null}
                      {line.isOwn ? <span className="block text-xs font-normal text-muted-foreground">Your own line</span> : null}
                      <LineFlags runId={sheet.run.id} line={line} period={{ start: sheet.run.periodStart, end: sheet.run.periodEnd }} canAct={canActOnLines} correctableRuns={sheet.correctableRuns} />
                      <Pending line={line} />
                      {line.items.some((i) => i.correctsRunId && i.state === "confirmed") ? (
                        <span className="block text-xs font-normal text-muted-foreground">{L.hasCorrection}</span>
                      ) : null}
                    </TableCell>
                    <TableCell label={L.client} className={`${FROZEN} md:left-44 border-r`}>
                      {line.clientName ?? L.noClient}
                    </TableCell>
                    {line.unreadable ? (
                      <TableCell label={L.net} colSpan={22} className="text-destructive">
                        {L.unreadable}
                      </TableCell>
                    ) : (
                      <>
                        {cell(String(line.hoursPerDay), L.hoursPerDay, D)}
                        {cell(f?.monthly, L.monthly, D)}
                        {cell(f?.base, L.base)}
                        {cell(f?.absences, L.absences, D)}
                        {cell(f?.sickLeave, L.sickLeave, D)}
                        {cell(f?.late, L.late, D)}
                        {EXTRA_KEYS.map((k) => (
                          <TableCell key={k} label={PAY_ITEM_LABELS[EXTRA_KEY_ITEM[k]]} className={`${num} ${D}`}>
                            {f?.extra[k]}
                          </TableCell>
                        ))}
                        {cell(f?.bereavementDays, L.bereavement, D)}
                        {cell(f?.ptoDays, L.pto, D)}
                        {cell(f?.allowances, L.allowances, D)}
                        {cell(f?.gross, L.gross)}
                        {cell(f?.reimbursements, L.reimbursements, D)}
                        {cell(f?.bonuses, L.bonuses, D)}
                        {cell(f?.adjustments, L.adjustments, D)}
                        {cell(f?.loan, L.loan, D)}
                        {cell(f?.otherDeductions, L.otherDeductions, D)}
                        {cell(f?.net, L.net, "font-semibold")}
                        {cell(f ? (f.netChange ?? "") : undefined, L.netChange, "text-muted-foreground")}
                        {cell(f?.clientHours, L.clientHours)}
                      </>
                    )}
                    <TableCell label={L.confirmation}>{line.confirmedByName ?? <span className="text-muted-foreground">{L.unconfirmed}</span>}</TableCell>
                    <TableCell label={L.actions} className="md:sticky md:right-0 z-10 bg-card">
                      {canActOnLines ? <LineActions runId={sheet.run.id} line={line} correctableRuns={sheet.correctableRuns} /> : null}
                    </TableCell>
                  </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </WorksheetColumns>
      </div>
    </div>
  );
}
