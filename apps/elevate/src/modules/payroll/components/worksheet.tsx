import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXTRA_KEYS } from "../calculate";
import { EXTRA_KEY_ITEM, LINE_FLAG_LABELS, PAY_ITEM_LABELS, WORKSHEET_LABELS as L } from "../constants";
import type { Worksheet, WorksheetLine } from "../runs";
import { ConfirmLineButton, ItemDialog } from "./item-dialog";

// The sheet: one row per pay line, columns in the order the pay is worked out. Name and client stay in view when it scrolls sideways;
// below the tablet width each row becomes a card (`stack`).

const FROZEN = "md:sticky z-10 bg-card";
const num = "text-right tabular-nums";
const head = "whitespace-normal align-bottom";

function Pending({ line }: { line: WorksheetLine }) {
  const suggested = line.items.filter((i) => i.state === "suggested").length;
  return suggested > 0 ? <span className="block text-xs text-muted-foreground">{suggested} suggested, not yet confirmed</span> : null;
}

export function Worksheet({ sheet, lines, canPrepare }: { sheet: Worksheet; lines: WorksheetLine[]; canPrepare: boolean }) {
  const draft = sheet.run.status === "draft";
  return (
    <div className="space-y-6">
      <Table stack>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead colSpan={2} className={`${FROZEN} md:left-0 border-r`}>
              {L.groups.person}
            </TableHead>
            <TableHead colSpan={4}>{L.groups.basis}</TableHead>
            <TableHead colSpan={2}>{L.groups.deductions}</TableHead>
            <TableHead colSpan={EXTRA_KEYS.length}>{L.groups.extra}</TableHead>
            <TableHead colSpan={3}>{L.groups.allowances}</TableHead>
            <TableHead colSpan={3}>{L.groups.adjustments}</TableHead>
            <TableHead colSpan={2}>{L.groups.result}</TableHead>
            <TableHead colSpan={1}>{L.groups.reference}</TableHead>
            <TableHead colSpan={2}>
              <span className="sr-only">{L.actions}</span>
            </TableHead>
          </TableRow>
          <TableRow>
            <TableHead className={`${FROZEN} md:left-0 min-w-44`}>{L.person}</TableHead>
            <TableHead className={`${FROZEN} md:left-44 min-w-36 border-r`}>{L.client}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.hoursPerDay}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.fte}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.monthly}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.base}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.absences}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.late}</TableHead>
            {EXTRA_KEYS.map((k) => (
              <TableHead key={k} className={`${head} ${num} min-w-28`}>
                {PAY_ITEM_LABELS[EXTRA_KEY_ITEM[k]]}
              </TableHead>
            ))}
            <TableHead className={`${head} ${num}`}>{L.pesoAllowance}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.dollarAllowance}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.dollarAllowancePesos}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.adjustment}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.loan}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.otherDeductions}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.gross}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.net}</TableHead>
            <TableHead className={`${head} ${num}`}>{L.clientHours}</TableHead>
            <TableHead className={head}>{L.confirmation}</TableHead>
            <TableHead>
              <span className="sr-only">{L.actions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const f = line.figures;
            const cell = (value: string | undefined, label: string, extra = "") => (
              <TableCell label={label} className={`${num} ${extra}`}>
                {line.unreadable || value === undefined ? "" : value}
              </TableCell>
            );
            return (
              <TableRow key={line.runLineId}>
                <TableCell label={L.person} className={`${FROZEN} md:left-0 font-medium`}>
                  {line.name}
                  {line.alias ? <span className="block text-xs font-normal text-muted-foreground">{line.alias}</span> : null}
                  {line.isOwn ? <span className="block text-xs font-normal text-muted-foreground">Your own line</span> : null}
                  {line.flags.map((flag) => (
                    <Badge key={flag} variant="warning" className="mt-1 mr-1">
                      {LINE_FLAG_LABELS[flag] ?? flag}
                    </Badge>
                  ))}
                  <Pending line={line} />
                </TableCell>
                <TableCell label={L.client} className={`${FROZEN} md:left-44 border-r`}>
                  {line.clientName ?? L.noClient}
                </TableCell>
                {line.unreadable ? (
                  <TableCell label={L.net} colSpan={20} className="text-destructive">
                    {L.unreadable}
                  </TableCell>
                ) : (
                  <>
                    {cell(String(line.hoursPerDay), L.hoursPerDay)}
                    {cell(line.fte, L.fte)}
                    {cell(f?.monthly, L.monthly)}
                    {cell(f?.base, L.base)}
                    {cell(f?.absences, L.absences)}
                    {cell(f?.late, L.late)}
                    {EXTRA_KEYS.map((k) => (
                      <TableCell key={k} label={PAY_ITEM_LABELS[EXTRA_KEY_ITEM[k]]} className={num}>
                        {f?.extra[k]}
                      </TableCell>
                    ))}
                    {cell(f?.pesoAllowance, L.pesoAllowance)}
                    {cell(f?.dollarAllowance, L.dollarAllowance)}
                    {cell(f?.dollarAllowancePesos, L.dollarAllowancePesos)}
                    {cell(f?.adjustment, L.adjustment)}
                    {cell(f?.loan, L.loan)}
                    {cell(f?.otherDeductions, L.otherDeductions)}
                    {cell(f?.gross, L.gross)}
                    {cell(f?.net, L.net, "font-semibold")}
                    {cell(f?.clientHours, L.clientHours)}
                  </>
                )}
                <TableCell label={L.confirmation}>{line.confirmedByName ?? <span className="text-muted-foreground">{L.unconfirmed}</span>}</TableCell>
                <TableCell label={L.actions}>
                  {canPrepare && draft ? (
                    <div className="flex flex-wrap gap-2">
                      {line.isOwn ? null : <ItemDialog runId={sheet.run.id} line={line} />}
                      <ConfirmLineButton line={line} />
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
