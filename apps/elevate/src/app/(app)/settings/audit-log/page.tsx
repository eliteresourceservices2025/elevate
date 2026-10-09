import type { Metadata } from "next";
import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { pageInfo } from "@/lib/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, SECONDARY_TIMEZONE, formatInZone } from "@/lib/time";
import { listAuditEntries } from "@/modules/settings/queries";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditLogPage({ searchParams }: PageProps<"/settings/audit-log">) {
  const params = await searchParams;
  const { rows, page, total, pageSize, action } = await orNotFound(listAuditEntries({
    page: typeof params.page === "string" ? params.page : undefined,
    size: typeof params.size === "string" ? params.size : undefined,
    action: typeof params.action === "string" ? params.action : undefined,
  })); // authorize("settings.view_audit") inside

  const info = pageInfo(total, page, pageSize);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Audit log</h1>
        <p className="mt-1 text-muted-foreground">
          {total} entries. Times shown in {DEFAULT_TIMEZONE} and {SECONDARY_TIMEZONE}. Entries cannot be edited or
          deleted.
        </p>
      </div>

      <form className="flex items-end gap-3" action="/settings/audit-log">
        <div className="space-y-1.5">
          <Label htmlFor="action">Action starts with</Label>
          <Input id="action" name="action" defaultValue={action} placeholder="roles, auth.login, invitation" />
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <Table containerClassName="[--shadow-cover:var(--background)]">
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                Nothing matches.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-xs">
                {formatInZone(r.occurredAt, DEFAULT_TIMEZONE, "MMM d, h:mm:ss a")}
                <div className="text-muted-foreground">{formatInZone(r.occurredAt, SECONDARY_TIMEZONE, "MMM d, h:mm a")}</div>
              </TableCell>
              <TableCell>{r.actorEmail ?? "system"}</TableCell>
              <TableCell className="font-mono text-xs">{r.action}</TableCell>
              <TableCell className="text-xs">
                {r.targetType ? `${r.targetType}: ` : ""}
                <span className="break-all">{r.targetId ?? "—"}</span>
              </TableCell>
              <TableCell className="max-w-xs text-xs">
                {r.before || r.after || r.metadata ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono">
                    {JSON.stringify({ before: r.before ?? undefined, after: r.after ?? undefined, ...(r.metadata as object | null) }, null, 1)}
                  </pre>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <PagerLinks info={info} basePath="/settings/audit-log" query={{ action: action || undefined }} label="entries" />
    </div>
  );
}
