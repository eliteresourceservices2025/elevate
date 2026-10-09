import Link from "next/link";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, CONDITION_LABELS, STATUS_LABELS, assetPath, type AssetStatus } from "../constants";
import type { AssetRow, HeldRow, HistoryRow } from "../queries";

const day = (d: Date) => formatInZone(d, DEFAULT_TIMEZONE, "yyyy-MM-dd");
const th = "px-3 py-2 text-left font-medium";
const td = "px-3 py-2 align-top";

const STATUS_STYLE: Record<AssetStatus, string> = {
  in_stock: "bg-emerald-100 text-emerald-900",
  assigned: "bg-violet-100 text-violet-900",
  repair: "bg-amber-100 text-amber-900",
  lost: "bg-red-100 text-red-900",
  retired: "bg-neutral-200 text-neutral-800",
};

export function StatusBadge({ status }: { status: AssetStatus }) {
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>{STATUS_LABELS[status]}</span>;
}

export function InventoryTable({ rows }: { rows: AssetRow[] }) {
  if (rows.length === 0) return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No items match.</p>;
  return (
    <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-secondary/40">
          <tr>
            <th className={th}>Tag</th>
            <th className={th}>Name</th>
            <th className={th}>Category</th>
            <th className={th}>Status</th>
            <th className={th}>With</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className={td}>
                <Link href={assetPath(r.tag)} className="font-mono text-primary underline-offset-2 hover:underline">
                  {r.tag}
                </Link>
              </td>
              <td className={td}>{r.name}</td>
              <td className={td}>{CATEGORY_LABELS[r.category]}</td>
              <td className={td}>
                <StatusBadge status={r.status} />
                {r.archived ? <span className="ml-1 text-xs text-muted-foreground">archived</span> : null}
              </td>
              <td className={td}>{r.holder ? r.holder.name : <span className="text-muted-foreground">-</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Items currently with someone: the signed-in person's own, or a team lead's downline (with a Person column). */
export function HeldTable({ rows, showPerson, empty }: { rows: HeldRow[]; showPerson?: boolean; empty: string }) {
  if (rows.length === 0) return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-secondary/40">
          <tr>
            {showPerson ? <th className={th}>Person</th> : null}
            <th className={th}>Tag</th>
            <th className={th}>Item</th>
            <th className={th}>Category</th>
            <th className={th}>Since</th>
            <th className={th}>Condition</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.tag}-${r.assignedAt.toISOString()}`} className="border-b last:border-0">
              {showPerson ? <td className={td}>{r.holder}</td> : null}
              <td className={td}>
                <Link href={assetPath(r.tag)} className="font-mono text-primary underline-offset-2 hover:underline">
                  {r.tag}
                </Link>
              </td>
              <td className={td}>{r.name}</td>
              <td className={td}>{CATEGORY_LABELS[r.category]}</td>
              <td className={td}>{day(r.assignedAt)}</td>
              <td className={td}>{CONDITION_LABELS[r.condition]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HistoryTable({ rows, showPerson, showStaff }: { rows: HistoryRow[]; showPerson: boolean; showStaff: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No hand-overs yet.</p>;
  return (
    <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-secondary/40">
          <tr>
            {showPerson ? <th className={th}>Person</th> : null}
            <th className={th}>Handed over</th>
            <th className={th}>Condition</th>
            <th className={th}>Returned</th>
            <th className={th}>Condition</th>
            {showStaff ? <th className={th}>Handed over / received by</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              {showPerson ? <td className={td}>{r.person}</td> : null}
              <td className={td}>
                {day(r.assignedAt)}
                {r.assignNote ? <p className="text-xs text-muted-foreground">{r.assignNote}</p> : null}
              </td>
              <td className={td}>{CONDITION_LABELS[r.conditionOut]}</td>
              <td className={td}>
                {r.returnedAt ? day(r.returnedAt) : <span className="font-medium">Still assigned</span>}
                {r.returnNote ? <p className="text-xs text-muted-foreground">{r.returnNote}</p> : null}
              </td>
              <td className={td}>{r.conditionIn ? CONDITION_LABELS[r.conditionIn] : "-"}</td>
              {showStaff ? (
                <td className={td}>
                  {r.assignedBy}
                  {r.receivedBy ? ` / ${r.receivedBy}` : ""}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
