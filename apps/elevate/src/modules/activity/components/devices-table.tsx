"use client";

import Link from "next/link";
import { StatusChip } from "@/components/status-chip";
import { useAsk } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/time";
import { useRun } from "@/modules/attendance/components/use-run";
import { revokeDevice } from "../actions";
import type { FleetRow } from "../queries";

const OS: Record<string, string> = { windows: "Windows", macos: "macOS" };

function SignOutButton({ id, person }: { id: string; person: string }) {
  const { run, pending } = useRun();
  const ask = useAsk();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!(await ask(`Sign out this computer of ${person}? The app stops recording at once and must be added again with a new code.`, { confirmLabel: "Sign out", destructive: true }))) return;
        run(() => revokeDevice({ deviceId: id }), () => "Computer signed out.");
      }}
    >
      Sign out
    </Button>
  );
}

export function DevicesTable({ rows, zone }: { rows: FleetRow[]; zone: string }) {
  return (
    <Table stack>
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Computer</TableHead>
          <TableHead>App version</TableHead>
          <TableHead>Last seen</TableHead>
          <TableHead>Permissions</TableHead>
          <TableHead>Waiting to send</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.id}>
            <TableCell label="Person" className="font-medium">
              <Link href={`/activity/people/${d.employeeId}`} className="hover:underline">
                {d.person}
              </Link>
            </TableCell>
            <TableCell label="Computer">
              {d.name} <span className="text-muted-foreground">({OS[d.os] ?? d.os})</span>
            </TableCell>
            <TableCell label="App version" className="font-mono text-sm">
              {d.appVersion}
            </TableCell>
            <TableCell label="Last seen">{d.lastSeenAt ? formatInZone(d.lastSeenAt, zone, "MMM d, h:mm a") : "Never"}</TableCell>
            <TableCell label="Permissions">{d.permissionsOk ? <StatusChip tone="success">OK</StatusChip> : <StatusChip tone="danger">Permission missing</StatusChip>}</TableCell>
            <TableCell label="Waiting to send">{d.queueSize}</TableCell>
            <TableCell label="Status">{d.status === "active" ? <StatusChip tone="success">Signed in</StatusChip> : <StatusChip tone="neutral">Signed out</StatusChip>}</TableCell>
            <TableCell className="text-right">{d.status === "active" ? <SignOutButton id={d.id} person={d.person} /> : null}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
