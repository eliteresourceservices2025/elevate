"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly } from "@/lib/time";
import { STATUS_LABELS } from "../constants";
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
};

function SortHeader({ label, column, sort, dir, params }: { label: string; column: Sort } & Pick<Props, "sort" | "dir" | "params">) {
  const active = sort === column;
  const nextDir = active && dir === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams({ ...params, sort: column, dir: nextDir, page: "1" });
  return (
    <Link
      href={`/people?${qs.toString()}`}
      className="inline-flex items-center gap-1 font-medium hover:underline"
      aria-label={`Sort by ${label}${active ? `, currently ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
    >
      {label}
      {active ? dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : null}
    </Link>
  );
}

// Sorting, filtering and paging happen on the server (URL state); TanStack Table lays out the columns.
export function DirectoryTable({ rows, seesClients, sort, dir, params }: Props) {
  "use no memo"; // TanStack Table returns functions the React Compiler cannot memoize safely
  const columns = useMemo<ColumnDef<DirectoryRow>[]>(() => {
    const cols: ColumnDef<DirectoryRow>[] = [
      {
        id: "name",
        header: () => <SortHeader label="Name" column="name" sort={sort} dir={dir} params={params} />,
        cell: ({ row }) => (
          <div>
            <Link href={`/people/${row.original.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {displayName(row.original)}
            </Link>
            <div className="text-xs text-muted-foreground">{row.original.employeeNumber}</div>
          </div>
        ),
      },
      {
        id: "position",
        header: () => <SortHeader label="Position" column="position" sort={sort} dir={dir} params={params} />,
        cell: ({ row }) => row.original.position ?? "—",
      },
      { id: "email", header: () => "Work email", cell: ({ row }) => <span className="break-all">{row.original.workEmail}</span> },
    ];
    if (seesClients) cols.push({ id: "clients", header: () => "Client", cell: ({ row }) => row.original.clientNames ?? "—" });
    cols.push(
      {
        id: "status",
        header: () => <SortHeader label="Status" column="status" sort={sort} dir={dir} params={params} />,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Badge variant={row.original.status === "active" ? "default" : "secondary"}>{STATUS_LABELS[row.original.status]}</Badge>
            {row.original.archived ? <Badge variant="outline">Archived</Badge> : null}
          </div>
        ),
      },
      {
        id: "start",
        header: () => <SortHeader label="Started" column="start" sort={sort} dir={dir} params={params} />,
        cell: ({ row }) => formatDateOnly(row.original.startDate),
      },
    );
    return cols;
  }, [seesClients, sort, dir, params]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), manualSorting: true, manualPagination: true });

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((h) => (
              <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
              No one matches those filters.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
