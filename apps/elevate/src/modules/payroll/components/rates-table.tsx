"use client";

import { ChevronDown, Plus, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ClientPager, usePaged } from "@/components/client-pager";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RATES_LABELS as L, UNREADABLE_HINT, unreadableNotice } from "../constants";
import type { CutoffChoice } from "../rate-start";
import type { RateOptions, RateRow } from "../queries";
import { AddContractorForm, DoubledRatesForm, EditDetailsForm, RemoveRateForm, RemoveStoppedForm, StopPayingForm, UpdateRateForm } from "./rate-forms";
import { ariaSortOf, SortHead, type SortLinks } from "./sort-head";

// One row per rate, grouped under the person (the name is written once, on the first row of a person). The main button is "Update rate"; the
// less common things (edit details, stop paying, remove a rate added by mistake) are in the menu. The dialogs sit outside the menu: a menu
// closes as soon as an item is picked, which would close a dialog that lived inside it.

function RowMenu({ row, options, cutoffs }: { row: RateRow; options: RateOptions; cutoffs: CutoffChoice[] }) {
  const [details, setDetails] = useState(false);
  const [stop, setStop] = useState(false);
  const [remove, setRemove] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" aria-label={`More for ${row.name}`} className="pointer-coarse:h-10 pointer-coarse:px-4" />}>
          More
          <ChevronDown className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem disabled={row.unreadable} onClick={() => setDetails(true)}>
            Edit details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStop(true)}>Stop paying</DropdownMenuItem>
          {row.onRealRun ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setRemove(true)}>
                Remove (added by mistake)
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog label="Edit details" title={`Edit ${row.name}'s details`} description="Client, alias, hours, payment method and overtime. Saved as a new version; the old one stays on record." size="lg" open={details} onOpenChange={setDetails} hideTrigger>
        <EditDetailsForm row={row} options={options} cutoffs={cutoffs} />
      </FormDialog>
      <FormDialog label="Stop paying" title={`Stop paying ${row.name}`} description="The rate stays on record. Pay runs after the last cutoff leave it out." open={stop} onOpenChange={setStop} hideTrigger>
        <StopPayingForm row={row} cutoffs={cutoffs} />
      </FormDialog>
      <FormDialog label="Remove this rate" title={`Remove ${row.name}'s rate`} description="For a rate added by mistake." open={remove} onOpenChange={setRemove} hideTrigger>
        <RemoveRateForm row={row} />
      </FormDialog>
    </>
  );
}

export function RatesTable({
  rows,
  options,
  cutoffs,
  sortLinks,
  sortMenu,
  endedToggle,
}: {
  rows: RateRow[];
  options: RateOptions | null;
  cutoffs: CutoffChoice[];
  endedToggle?: { showing: boolean; href: string };
  sortLinks?: SortLinks;
  sortMenu?: React.ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = rows.filter((r) => `${r.name} ${r.clientName ?? ""} ${r.alias ?? ""}`.toLowerCase().includes(needle));
  const paged = usePaged(shown, filter);
  const preparing = cutoffs.find((c) => c.beingPrepared);

  return (
    <div className="space-y-4">
      <Alert variant="info" role="note" className="rounded-lg p-3 text-sm">
        These are pay figures. Opening this page is written to the audit log.
        {preparing ? ` A new rate counts from a pay run: the next one to prepare is ${preparing.range}.` : ""} Pay runs that are already made are never changed, and every old rate stays on record.
      </Alert>
      {rows.some((r) => r.unreadable) ? (
        <Alert variant="warning" role="alert" className="rounded-lg p-3 text-sm">
          {unreadableNotice(rows.filter((r) => r.unreadable).length)}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label htmlFor="rates-filter" className="text-xs">
            Find a person, client or alias
          </Label>
          <Input id="rates-filter" className="h-8 w-64" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {endedToggle ? (
            <Link href={endedToggle.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {endedToggle.showing ? "Hide stopped rates" : "Show stopped rates"}
            </Link>
          ) : null}
          {sortMenu}
          {options && endedToggle?.showing ? (
            <FormDialog label="Remove stopped rates" title="Remove stopped rates" description="Take stopped rates that were never paid off this list." variant="outline" size="md">
              <RemoveStoppedForm />
            </FormDialog>
          ) : null}
          {options ? (
            <FormDialog label="Remove doubled rates" title="Remove doubled rates" description="The same person and client with two overlapping rates would be paid twice." variant="outline" size="lg">
              <DoubledRatesForm />
            </FormDialog>
          ) : null}
          {options ? (
            <FormDialog label="Add contractor" title="Add a contractor" description="Someone who works for two clients gets one rate for each client." icon={<Plus className="size-4" aria-hidden />} size="lg">
              <AddContractorForm options={options} cutoffs={cutoffs} rows={rows} />
            </FormDialog>
          ) : null}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No rates yet" description={options ? "Add a contractor to start paying them." : "A Preparer adds the rates."} />
      ) : (
        <>
          <Table stack dragScroll scrollLabel="Rates. Drag sideways or use the arrow keys to scroll.">
            <TableHeader>
              <TableRow>
                <TableHead aria-sort={ariaSortOf(sortLinks, "name")}>
                  <SortHead header="name" links={sortLinks}>
                    {L.person}
                  </SortHead>
                </TableHead>
                <TableHead aria-sort={ariaSortOf(sortLinks, "client")}>
                  <SortHead header="client" links={sortLinks}>
                    {L.clientShort}
                  </SortHead>
                </TableHead>
                <TableHead aria-sort={ariaSortOf(sortLinks, "rate")}>
                  <SortHead header="rate" links={sortLinks}>
                    {L.monthly}
                  </SortHead>
                </TableHead>
                <TableHead>{L.paying}</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((row, i) => {
                const repeat = i > 0 && paged.rows[i - 1].employeeId === row.employeeId;
                const detail = [row.alias, `${row.hoursPerDay} hours a day`].filter(Boolean).join(" · ");
                return (
                  <TableRow key={row.lineKey}>
                    <TableCell label={L.person} className="font-medium">
                      <span className={repeat ? "text-muted-foreground md:sr-only" : undefined}>{row.name}</span>
                    </TableCell>
                    <TableCell label={L.clientShort}>
                      {row.clientName ?? "No client"}
                      <span className="block text-xs text-muted-foreground">{detail}</span>
                    </TableCell>
                    <TableCell label={L.monthly} className="tabular-nums">
                      {row.monthly}
                    </TableCell>
                    <TableCell label={L.paying}>
                      Since {row.effectiveFrom}
                      {row.upcomingFrom ? <span className="block text-xs text-muted-foreground">New rate from {row.upcomingFrom}</span> : null}
                      {row.endsOn ? <span className="block text-xs text-muted-foreground">{row.ended ? "Stopped" : "Stops"} after {row.endsOn}</span> : null}
                    </TableCell>
                    <TableCell label="Actions">
                      {options && row.endsOn && !row.onRealRun ? (
                        <FormDialog label="Remove" title={`Remove ${row.name}'s stopped rate`} description="It was never on a real pay run." variant="outline" triggerSize="sm">
                          <RemoveRateForm row={row} />
                        </FormDialog>
                      ) : null}
                      {options && !row.endsOn ? (
                        <div className="flex flex-wrap gap-2">
                          <FormDialog
                            label="Update rate"
                            title={`Update ${row.name}'s rate`}
                            description={`${row.clientName ?? "No client"}${row.alias ? `, ${row.alias}` : ""}. Saved as a new version of this rate; the old one stays on record.`}
                            variant="outline"
                            triggerSize="sm"
                            size="lg"
                            icon={<TrendingUp className="size-4" aria-hidden />}
                            disabled={row.unreadable}
                            hint={UNREADABLE_HINT}
                          >
                            <UpdateRateForm row={row} cutoffs={cutoffs} />
                          </FormDialog>
                          <RowMenu row={row} options={options} cutoffs={cutoffs} />
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="rates" />
        </>
      )}
    </div>
  );
}
