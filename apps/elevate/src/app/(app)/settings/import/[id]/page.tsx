import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { BatchActions } from "@/modules/imports/components/batch-actions";
import { ROW_FILTERS, getBatch, getReconciliation, listBatchRows, type RowFilter } from "@/modules/imports/queries";

export const metadata: Metadata = { title: "Import" };

const FILTER_LABEL: Record<RowFilter, string> = { all: "All", new: "New", changed: "Changed", unchanged: "Unchanged", error: "Errors", warnings: "Warnings" };

export default async function ImportBatchPage({ params, searchParams }: PageProps<"/settings/import/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const filter = (ROW_FILTERS as readonly string[]).includes(one(sp.filter) ?? "") ? (one(sp.filter) as RowFilter) : "all";
  const paging = parsePaging({ page: one(sp.page), size: one(sp.size) });
  const batch = await orNotFound(getBatch(id));
  const { rows, total } = await orNotFound(listBatchRows(id, { filter, page: paging.page, pageSize: paging.pageSize }));
  const info = pageInfo(total, paging.page, paging.pageSize);
  const rec = batch.status === "committed" ? await orNotFound(getReconciliation(id)) : null;
  const s = batch.summary;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/settings/import" className="text-sm text-primary underline-offset-2 hover:underline">
          All imports
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{batch.fileName}</h1>
        <p className="text-muted-foreground">
          {batch.rowCount} rows. {batch.status === "preview" ? "Nothing has been created yet." : batch.status === "committed" ? "Committed." : batch.status === "rolled_back" ? "Rolled back." : "Discarded."}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["New people", s.new],
            ["Changed", s.changed],
            ["Unchanged", s.unchanged],
            ["Errors", s.errors],
            ["Warnings", s.warnings],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold">{value ?? 0}</dd>
          </div>
        ))}
      </dl>

      <BatchActions batchId={batch.id} status={batch.status} errors={s.errors ?? 0} signedOff={Boolean(batch.signedOffAt)} />

      {rec ? (
        <section aria-label="Reconciliation" className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Reconciliation {rec.clean ? <Badge variant="secondary">All counts match</Badge> : <Badge variant="destructive">Mismatches</Badge>}
          </h2>
          <ul className="text-sm">
            {rec.checks.map((c) => (
              <li key={c.label} className={c.expected === c.actual ? "" : "font-medium text-destructive"}>
                {c.label}: file {c.expected}, ELEVATE {c.actual}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{rec.notes.join(" ")}</p>
          {rec.signedOffAt ? <p className="text-sm">Signed off on {rec.signedOffAt.toISOString().slice(0, 10)}.</p> : null}
        </section>
      ) : null}

      <section aria-label="Rows" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Rows</h2>
          {ROW_FILTERS.map((f) => (
            <Link key={f} href={f === "all" ? `/settings/import/${id}` : `/settings/import/${id}?filter=${f}`} aria-current={f === filter ? "true" : undefined} className={`rounded-full border px-3 py-0.5 text-sm ${f === filter ? "bg-primary text-primary-foreground" : "hover:bg-secondary/50"}`}>
              {FILTER_LABEL[f]}
            </Link>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows here.</p>
        ) : (
          <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Problems</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.rowNo}>
                    <TableCell>{r.rowNo}</TableCell>
                    <TableCell>
                      <p className="font-medium">{r.name || "Not readable"}</p>
                      <p className="text-xs text-muted-foreground">{[r.email, r.detail].filter(Boolean).join(", ")}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.outcome === "error" ? "destructive" : "secondary"}>{r.outcome}</Badge>
                      {r.changedFields.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{r.changedFields.join(", ")}</p> : null}
                      {r.state !== "staged" ? <p className="mt-1 text-xs text-muted-foreground">{r.state.replace("_", " ")}</p> : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.issues.length === 0 ? (
                        ""
                      ) : (
                        <ul>
                          {r.issues.map((i, k) => (
                            <li key={k} className={i.level === "error" ? "text-destructive" : "text-muted-foreground"}>
                              {i.field}: {i.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <PagerLinks info={info} basePath={`/settings/import/${id}`} query={{ filter: filter === "all" ? undefined : filter }} label="rows" />
      </section>
    </div>
  );
}
