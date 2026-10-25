"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { withReturn } from "@/lib/return-to";
import { initialsOf } from "@/lib/initials";
import { formatDateOnly } from "@/lib/time";
import { STATUS_BADGE, STATUS_LABELS } from "../constants";
import { displayName } from "../format";
import type { DirectoryRow } from "../queries";

type Sort = "name" | "position" | "status" | "start";
type Props = {
  rows: DirectoryRow[];
  seesClients: boolean;
  sort: Sort;
  dir: "asc" | "desc";
  /** Current filters, kept when a header is clicked to change the sort. */
  params: Record<string, string>;
  /** This list's own address (filters, sort, page): the profile it opens gets a "back to the list" breadcrumb. */
  returnTo?: string;
};

function StatusBadges({ row }: { row: DirectoryRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge variant={STATUS_BADGE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
      {row.archived ? <Badge variant="outline">Archived</Badge> : null}
    </span>
  );
}

function Initials({ row }: { row: DirectoryRow }) {
  return (
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
      {initialsOf(displayName(row), row.workEmail)}
    </span>
  );
}

function SortHeader({ label, column, sort, dir, params }: { label: string; column: Sort } & Pick<Props, "sort" | "dir" | "params">) {
  const active = sort === column;
  const nextDir = active && dir === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams({ ...params, sort: column, dir: nextDir, page: "1" });
  return (
    <Link
      href={`/people?${qs.toString()}`}
      className="inline-flex items-center gap-1 hover:text-foreground"
      aria-label={`Sort by ${label}${active ? `, currently ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
    >
      {label}
      {active ? dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : null}
    </Link>
  );
}

// Sorting, filtering and paging happen on the server (URL state); TanStack Table lays out the columns.
export function DirectoryTable({ rows, seesClients, sort, dir, params, returnTo }: Props) {
  "use no memo"; // TanStack Table returns functions the React Compiler cannot memoize safely
  const columns = useMemo<ColumnDef<DirectoryRow>[]>(() => {
    const cols: ColumnDef<DirectoryRow>[] = [
      {
        id: "name",
        header: () => <SortHeader label="Name" column="name" sort={sort} dir={dir} params={params} />,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Initials row={row.original} />
            <div className="min-w-0">
              <Link href={withReturn(`/people/${row.original.id}`, returnTo)} className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
                {displayName(row.original)}
              </Link>
              <div className="max-w-[22rem] truncate text-xs text-muted-foreground">
                {row.original.employeeNumber}
                <span className="hidden lg:inline"> · {row.original.workEmail}</span>
              </div>
            </div>
          </div>
        ),
      },
      {
        id: "position",
        header: () => <SortHeader label="Position" column="position" sort={sort} dir={dir} params={params} />,
        cell: ({ row }) => row.original.position ?? "—",
      },
      { id: "team", header: () => "Team", cell: ({ row }) => <span className="text-muted-foreground">{row.original.team ?? "—"}</span> },
    ];
    if (seesClients) cols.push({ id: "clients", header: () => "Client", cell: ({ row }) => <span className="text-muted-foreground">{row.original.clientNames ?? "—"}</span> });
    cols.push(
      {
        id: "status",
        header: () => <SortHeader label="Status" column="status" sort={sort} dir={dir} params={params} />,
        cell: ({ row }) => <StatusBadges row={row.original} />,
      },
      {
        id: "start",
        header: () => <SortHeader label="Started" column="start" sort={sort} dir={dir} params={params} />,
        cell: ({ row }) => <span className="text-muted-foreground">{formatDateOnly(row.original.startDate)}</span>,
      },
    );
    return cols;
  }, [seesClients, sort, dir, params]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), manualSorting: true, manualPagination: true });

  if (rows.length === 0) return <EmptyState className="m-4 border-0" title="No one matches those filters" description="Try a different search, or clear the filters." />;

  return (
    <>
      {/* Phone: one card per person. The table below takes over from the tablet width. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground md:hidden">
        Sort by
        <SortHeader label="Name" column="name" sort={sort} dir={dir} params={params} />
        <SortHeader label="Position" column="position" sort={sort} dir={dir} params={params} />
        <SortHeader label="Status" column="status" sort={sort} dir={dir} params={params} />
        <SortHeader label="Started" column="start" sort={sort} dir={dir} params={params} />
      </div>
      <ul className="divide-y md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={withReturn(`/people/${row.id}`, returnTo)} className="flex items-start gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <Initials row={row} />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="font-medium">{displayName(row)}</span>
                  <StatusBadges row={row} />
                </span>
                {row.position ? <span className="block text-sm text-muted-foreground">{row.position}</span> : null}
                <span className="block text-xs text-muted-foreground">{[row.employeeNumber, row.team, seesClients ? row.clientNames : null].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table plain containerClassName="rounded-none border-0 shadow-none">
          <TableHeader className="bg-secondary/40">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((h) => (
                  <TableHead key={h.id} className="h-10 px-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-4 py-3 whitespace-normal">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
