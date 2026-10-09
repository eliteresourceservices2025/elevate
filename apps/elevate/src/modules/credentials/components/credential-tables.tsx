import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CredentialRow } from "../queries";
import { STATUS_LABELS, type CredentialStatus } from "../rules";
import { RemoveCredentialButton } from "./credential-forms";

const th = "px-3 py-2 text-left font-medium";
const td = "px-3 py-2 align-top";

const STYLE: Record<CredentialStatus, string> = {
  expired: "bg-red-100 text-red-900",
  expiring: "bg-amber-100 text-amber-900",
  valid: "bg-emerald-100 text-emerald-900",
};

export function StatusBadge({ row }: { row: Pick<CredentialRow, "status" | "renewed"> }) {
  if (row.renewed) return <span className="inline-block rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-800">Renewed</span>;
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STYLE[row.status])}>{STATUS_LABELS[row.status]}</span>;
}

/** One list for all three views. `showPerson` adds the person (HR and leads); `canRemove` adds the remove button (HR). */
export function CredentialTable({ rows, empty, showPerson = false, canRemove = false }: { rows: CredentialRow[]; empty: string; showPerson?: boolean; canRemove?: boolean }) {
  if (rows.length === 0) return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-secondary/40">
          <tr>
            {showPerson ? <th className={th}>Person</th> : null}
            <th className={th}>Certificate</th>
            <th className={th}>Issued</th>
            <th className={th}>Ends</th>
            <th className={th}>Status</th>
            {canRemove ? <th className={cn(th, "text-right")}>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              {showPerson ? (
                <td className={td}>
                  {canRemove ? (
                    <Link href={`/people/${r.employeeId}`} className="text-primary underline-offset-2 hover:underline">
                      {r.person}
                    </Link>
                  ) : (
                    r.person
                  )}
                </td>
              ) : null}
              <td className={td}>{r.name}</td>
              <td className={td}>{r.issuedOn ?? "—"}</td>
              <td className={td}>{r.expiresOn}</td>
              <td className={td}>
                <StatusBadge row={r} />
              </td>
              {canRemove ? (
                <td className={cn(td, "text-right")}>
                  <RemoveCredentialButton id={r.id} label={`${r.name} for ${r.person}`} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
