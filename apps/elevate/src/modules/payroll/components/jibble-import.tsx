"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRun } from "@/modules/recruiting/components/use-run";
import { applyJibbleTimesheet, confirmAllSuggestions, discardJibbleTimesheet, uploadJibbleTimesheet } from "../actions";
import type { TimesheetPreview } from "../timesheet-import";

// Importing a Jibble timesheet into a draft run: choose the file, check who each Jibble member is, then fill the run with suggested amounts.

export function JibbleUploadForm({ runId }: { runId: string }) {
  const { run, pending } = useRun();
  const [name, setName] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.set("runId", runId);
        run(() => uploadJibbleTimesheet(data), (d) => `Read ${d?.members ?? 0} people from the timesheet. Check who is who below.`);
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="jibble-file">Jibble timesheet (Excel file)</Label>
        <Input id="jibble-file" name="file" type="file" accept=".xlsx" required onChange={(e) => setName(e.target.files?.[0]?.name ?? "")} />
        <p className="text-xs text-muted-foreground">
          The &quot;Custom Timesheets&quot; export from Jibble, up to 8 MB. Only each person&apos;s totals are read (payroll hours, overtime and PTO). Clock-in times are not kept, and the file is wiped once you fill the run, discard it, or after 14 days.
        </p>
      </div>
      <Button type="submit" disabled={pending || name === ""}>
        <Upload className="size-4" aria-hidden />
        Read the file
      </Button>
    </form>
  );
}

export function JibblePreview({ runId, preview }: { runId: string; preview: TimesheetPreview }) {
  const { run, pending } = useRun();
  const router = useRouter();
  const [chosen, setChosen] = useState<Record<string, string>>(() => Object.fromEntries(preview.members.map((m) => [m.code, m.runLineId ?? ""])));
  const picked = Object.values(chosen).filter(Boolean);
  const clash = picked.length !== new Set(picked).size;
  const labelOf = new Map(preview.lines.map((l) => [l.runLineId, l.label]));

  return (
    <div className="space-y-4">
      <Alert variant="info" role="note" className="rounded-lg p-3 text-sm">
        Timesheet period: {preview.periodText ?? "not printed"}. This run covers {preview.runPeriod.start} to {preview.runPeriod.end}; only days inside it are counted.
        {preview.outsideDays > 0 ? ` ${preview.outsideDays} ${preview.outsideDays === 1 ? "day" : "days"} in the file fall outside the run and are ignored.` : ""}
      </Alert>
      {clash ? (
        <Alert variant="warning" role="alert" className="rounded-lg p-3 text-sm">
          Two people are set to the same pay line. Choose a different line for one of them before filling the run.
        </Alert>
      ) : null}
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>In Jibble</TableHead>
            <TableHead className="min-w-64">Pay line on this run</TableHead>
            <TableHead className="text-right">Days</TableHead>
            <TableHead className="text-right">Client payroll hours</TableHead>
            <TableHead className="text-right">Overtime</TableHead>
            <TableHead className="text-right">Rest day OT</TableHead>
            <TableHead className="text-right">Holiday pay</TableHead>
            <TableHead className="text-right">PTO days</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {preview.members.map((m) => {
            return (
              <TableRow key={m.code}>
                <TableCell label="In Jibble" className="font-medium">
                  {m.name}
                  <span className="block text-xs font-normal text-muted-foreground">{m.code}</span>
                </TableCell>
                <TableCell label="Pay line on this run">
                  <NativeSelect aria-label={`Pay line for ${m.name}`} value={chosen[m.code] ?? ""} onChange={(e) => setChosen({ ...chosen, [m.code]: e.target.value })}>
                    <option value="">Skip this person</option>
                    {[...m.candidates, ...preview.lines.map((l) => l.runLineId).filter((id) => !m.candidates.includes(id))].map((id) => (
                      <option key={id} value={id}>
                        {labelOf.get(id)}
                      </option>
                    ))}
                  </NativeSelect>
                  {m.matchedBy === "remembered" ? <span className="block text-xs text-muted-foreground">Matched from an earlier import</span> : null}
                  {m.matchedBy === null && chosen[m.code] === "" ? <span className="block text-xs text-muted-foreground">Choose a pay line, or skip.</span> : null}
                </TableCell>
                <TableCell label="Days" className="text-right tabular-nums">{m.days}</TableCell>
                <TableCell label="Client payroll hours" className="text-right tabular-nums">{m.clientHours}</TableCell>
                <TableCell label="Overtime" className="text-right tabular-nums">{m.overtime}</TableCell>
                <TableCell label="Rest day OT" className="text-right tabular-nums">{m.restDayOvertime}</TableCell>
                <TableCell label="Holiday pay" className="text-right tabular-nums">{m.holidayPay}</TableCell>
                <TableCell label="PTO days" className="text-right tabular-nums">{m.ptoDays}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={pending || clash || picked.length === 0}
          onClick={() =>
            run(
              () => applyJibbleTimesheet({ runId, importId: preview.importId, assignments: preview.members.map((m) => ({ code: m.code, runLineId: chosen[m.code] || null })) }),
              (d) => `Filled ${d?.lines ?? 0} pay lines with ${d?.written ?? 0} suggested amounts${d?.kept ? ` (${d.kept} left as you had confirmed them)` : ""}. Read them, then confirm.`,
              () => router.push(`/payroll/${runId}`),
            )
          }
        >
          Fill the run
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => discardJibbleTimesheet({ runId }), "Upload discarded.")}>
          Discard this upload
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Nothing changes anyone&apos;s pay yet: the amounts are written as suggestions on the run, where you confirm or change each one. Amounts you already confirmed are never overwritten.
      </p>
    </div>
  );
}

/** Confirms every suggested amount on the run in one step. */
export function ConfirmAllButton({ runId, count }: { runId: string; count: number }) {
  const { run, pending } = useRun();
  const confirm = useConfirm();
  if (count === 0) return null;
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({
          title: `Confirm all ${count} suggested amounts?`,
          description: "Every suggested amount on this run is confirmed as it is. Each line that changes needs a new check. You can still change an amount afterwards.",
          confirmLabel: `Confirm ${count} amounts`,
          cancelLabel: "Go back",
        });
        if (ok) run(() => confirmAllSuggestions({ runId }), (d) => `${d?.confirmed ?? 0} amounts confirmed.`);
      }}
    >
      Confirm all suggestions ({count})
    </Button>
  );
}
