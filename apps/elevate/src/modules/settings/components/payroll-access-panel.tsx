"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PayrollLevel } from "@/lib/roles";
import { PAYROLL_LEVEL_LABELS } from "@/modules/payroll/constants";
import { setPayrollAccess } from "../actions";
import type { PayrollAccessRow } from "../queries";

const NONE = "none";

function LevelSelect({ row }: { row: PayrollAccessRow }) {
  const [pending, startTransition] = useTransition();

  function change(value: string) {
    const level = value === NONE ? null : (value as PayrollLevel);
    startTransition(async () => {
      const result = await setPayrollAccess({ userId: row.userId, level });
      if (!result.ok) toast.error(result.error);
      else toast.success("Payroll access updated.");
    });
  }

  return (
    <>
      <Label htmlFor={`level-${row.userId}`} className="sr-only">
        Payroll access for {row.name}
      </Label>
      <select
        id={`level-${row.userId}`}
        className="h-(--control-h-sm) rounded-md border border-input bg-background px-2 text-sm"
        value={row.level ?? NONE}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
      >
        <option value={NONE}>No access</option>
        {(Object.keys(PAYROLL_LEVEL_LABELS) as PayrollLevel[]).map((level) => (
          <option key={level} value={level}>
            {PAYROLL_LEVEL_LABELS[level]}
          </option>
        ))}
      </select>
    </>
  );
}

export function PayrollAccessPanel({ rows }: { rows: PayrollAccessRow[] }) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = rows.filter((r) => r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle));
  const paged = usePaged(shown, filter);
  const count = (level: PayrollLevel) => rows.filter((r) => r.level === level).length;
  const thin = count("preparer") < 2 || count("approver") < 2;

  return (
    <div className="space-y-4">
      {thin ? (
        <Alert variant="warning" role="note" className="rounded-lg p-3 text-sm">
          Payroll needs at least 2 Preparers and 2 Approvers so no one is left without a second pair of eyes or a cover. Now: {count("preparer")}{" "}
          Preparers, {count("approver")} Approvers.
        </Alert>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="payroll-access-filter" className="text-xs">
          Find a person
        </Label>
        <Input id="payroll-access-filter" className="h-8 w-64" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Payroll access</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.rows.map((row) => (
            <TableRow key={row.userId}>
              <TableCell label="Person" className="font-medium">
                {row.name}
              </TableCell>
              <TableCell label="Email">{row.email}</TableCell>
              <TableCell label="Payroll access">
                <LevelSelect row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="people" />
    </div>
  );
}
