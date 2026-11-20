"use client";

import { ChevronDown, FileSpreadsheet, RefreshCw, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRun } from "@/modules/recruiting/components/use-run";
import { refreshSuggestions, updateRunPeople } from "../actions";
import { SUGGESTION_LABELS as S } from "../constants";

// One menu for the ways to fill or bring up to date a draft run, so the page header stays short.

function Choice({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <span className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </span>
  );
}

export function RunFillMenu({ runId }: { runId: string }) {
  const { run, pending } = useRun();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" disabled={pending} />}>
        Fill or update this run
        <ChevronDown className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuItem
          className="items-start py-2"
          onClick={() =>
            run(
              () => updateRunPeople({ runId }),
              (d) => (d && d.added + d.updated + d.removed === 0 ? "The run already matches the Rates tab." : `Run updated: ${d?.added ?? 0} added, ${d?.updated ?? 0} moved to a newer rate, ${d?.removed ?? 0} taken off.`),
            )
          }
        >
          <Choice icon={<Users className="size-4" aria-hidden />} title="Update people" hint="Add, move or take off people to match the Rates tab." />
        </DropdownMenuItem>
        <DropdownMenuItem className="items-start py-2" render={<Link href={`/payroll/${runId}/import`} />}>
          <Choice icon={<FileSpreadsheet className="size-4" aria-hidden />} title="Import Jibble timesheet" hint="Fill hours, overtime and PTO from a Jibble export file." />
        </DropdownMenuItem>
        <DropdownMenuItem className="items-start py-2" onClick={() => run(() => refreshSuggestions({ runId }), S.refreshed)}>
          <Choice icon={<RefreshCw className="size-4" aria-hidden />} title={S.refresh} hint="Suggest absences, lates and overtime from hours a lead approved." />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
