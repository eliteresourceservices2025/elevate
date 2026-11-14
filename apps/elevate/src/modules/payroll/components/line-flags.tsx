"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRun } from "@/modules/recruiting/components/use-run";
import { savePayItem } from "../actions";
import type { PayItemType } from "../constants";
import { flagPills, shortDate, type FlagKind } from "../flags";
import type { WorksheetLine } from "../runs";
import { ItemDialog } from "./item-dialog";

// The flags on a line, as short pills with the real date ("Starts 6 Nov", "New rate 10 Nov"). A pill opens a plain explanation of what
// ELEVATE will do, why, and the way to fix it, with buttons that do the fix. Only a Preparer on a draft run gets the buttons.

type Props = {
  runId: string;
  line: WorksheetLine;
  period: { start: string; end: string };
  /** A Preparer on a draft run: the fix buttons show. */
  canAct: boolean;
  correctableRuns: { id: string; label: string }[];
};

const longDate = (iso: string) => `${shortDate(iso)} ${iso.slice(0, 4)}`;

export function LineFlags({ runId, line, period, canAct, correctableRuns }: Props) {
  const pills = flagPills(line.flags, line.flagDates);
  const { run, pending } = useRun();
  const [open, setOpen] = useState(false);
  const [amountsFor, setAmountsFor] = useState<PayItemType | null>(null);
  if (pills.length === 0) return null;

  const has = (kind: FlagKind) => pills.some((p) => p.kind === kind);
  const entered = line.items.find((i) => i.type === "partial_days" && i.state !== "dismissed");
  const saveDays = (days: number) =>
    run(() => savePayItem({ runId, employeeId: line.employeeId, runLineId: line.runLineId, type: "partial_days", value: String(days) }), "Days saved. The line needs a new check.", () => setOpen(false));
  const openAmounts = (type: PayItemType) => {
    setOpen(false);
    setAmountsFor(type);
  };

  const partPeriod = has("starts") || has("ends");
  const first = line.name.split(" ")[0];

  return (
    <>
      <span className="mt-1 flex flex-wrap gap-1">
        {pills.map((p) => (
          <button key={p.kind} type="button" onClick={() => setOpen(true)} aria-label={`${p.text}. Why is this flagged?`} className={cn(badgeVariants({ variant: p.kind === "rate" ? "outline" : "warning" }), "cursor-pointer gap-1 font-normal")}>
            {p.text}
            <Info className="size-3" aria-hidden />
          </button>
        ))}
      </span>

      <FormDialog label="Why is this flagged?" title={`${line.name}: why is this flagged?`} open={open} onOpenChange={setOpen} hideTrigger>
        <div className="space-y-5 text-sm">
          {partPeriod ? (
            <section className="space-y-2" aria-label="Part of the cutoff">
              <h3 className="font-semibold">{has("starts") && has("ends") ? "Starts and ends part-way through this cutoff" : has("starts") ? "Starts part-way through this cutoff" : "Ends part-way through this cutoff"}</h3>
              <p>
                {has("starts") && line.flagDates.startsOn ? `${first}'s pay line starts on ${longDate(line.flagDates.startsOn)}, but this cutoff began on ${longDate(period.start)}. ` : ""}
                {has("ends") && line.flagDates.endsOn ? `${first}'s pay line ends on ${longDate(line.flagDates.endsOn)}, before this cutoff's last day (${longDate(period.end)}). ` : ""}
                ELEVATE pays a full cutoff unless you tell it how many days {first} worked.
              </p>
              {entered ? (
                <p className="rounded-md bg-muted p-2">
                  Days entered: <strong>{entered.value}</strong>
                  {entered.state === "suggested" ? " (waiting for a decision)" : ""}.
                </p>
              ) : null}
              {canAct ? (
                <div className="flex flex-wrap gap-2">
                  {!entered && line.suggestedDays !== null && line.suggestedDays > 0 ? (
                    <Button type="button" disabled={pending} onClick={() => saveDays(line.suggestedDays!)}>
                      Use {line.suggestedDays} {line.suggestedDays === 1 ? "day" : "days"}
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => openAmounts("partial_days")}>
                    {entered ? "Change the days" : "Enter different days"}
                  </Button>
                </div>
              ) : null}
              {!entered && line.suggestedDays !== null ? (
                <p className="text-xs text-muted-foreground">
                  The suggestion counts the weekdays (Monday to Friday) between the dates, up to a full cutoff. Holidays and {first}&apos;s own schedule aren&apos;t counted, so check it.
                </p>
              ) : null}
              <p className="text-xs">
                <Link href="/payroll/rates" className="underline underline-offset-2">
                  Wrong date? Fix it on the Rates tab
                </Link>
                , then use Update people.
              </p>
            </section>
          ) : null}

          {has("rate") ? (
            <section className="space-y-2" aria-label="New rate">
              <h3 className="font-semibold">A new rate starts part-way through this cutoff</h3>
              <p>
                {line.flagDates.rateChangeOn ? `${first}'s rate changes on ${longDate(line.flagDates.rateChangeOn)}. ` : ""}
                ELEVATE pays the rate that was in force on {longDate(period.start)} for the whole cutoff. The new rate counts from the next cutoff. If it should apply sooner, add an adjustment for the difference.
              </p>
              {canAct ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => openAmounts("adjustment")}>
                    Add an adjustment
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Keep it as is
                  </Button>
                </div>
              ) : null}
              <p className="text-xs">
                <Link href="/payroll/rates" className="underline underline-offset-2">
                  Rate dated wrong? Fix it on the Rates tab
                </Link>
                , then use Update people.
              </p>
            </section>
          ) : null}

          {has("left") ? (
            <section className="space-y-2" aria-label="Has left">
              <h3 className="font-semibold">{first} has left</h3>
              <p>ELEVATE shows this person as no longer working here. Check they should still be paid for this cutoff. If not, take them off the run from the Actions menu (Remove from this run).</p>
            </section>
          ) : null}
        </div>
      </FormDialog>

      {amountsFor ? (
        <ItemDialog runId={runId} line={line} correctableRuns={correctableRuns} initialType={amountsFor} open onOpenChange={(o) => !o && setAmountsFor(null)} hideTrigger />
      ) : null}
    </>
  );
}
