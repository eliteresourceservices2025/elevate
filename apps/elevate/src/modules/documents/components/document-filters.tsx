"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { DocumentRow, FolderRow } from "../queries";
import { DocumentList } from "./document-list";
import { TypeBadge } from "./type-badge";

export type GroupBy = "none" | "type" | "folder";

/** Search, type filter and grouping for a list of documents, all in the browser on the rows already loaded. */
export function useDocumentFilters(rows: DocumentRow[]) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");
  const [group, setGroup] = useState<GroupBy>("none");

  const types = useMemo(() => {
    const seen = new Map<string, { slug: string; name: string; count: number }>();
    for (const r of rows) seen.set(r.typeSlug, { slug: r.typeSlug, name: r.typeName, count: (seen.get(r.typeSlug)?.count ?? 0) + 1 });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // A type that no longer has a document (the last one was archived or moved) is no longer there to be selected.
  const activeType = type === "all" || types.some((t) => t.slug === type) ? type : "all";
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(
    () => rows.filter((r) => (activeType === "all" || r.typeSlug === activeType) && (needle === "" || `${r.title} ${r.fileName} ${r.typeName}`.toLowerCase().includes(needle))),
    [rows, activeType, needle],
  );
  return { q, setQ, type: activeType, setType, group, setGroup, types, filtered, filtering: activeType !== "all" || needle !== "" };
}

type Filters = ReturnType<typeof useDocumentFilters>;

/** The search box, the type chips (with counts) and the group-by choice. */
export function DocumentFilterBar({ filters, canGroupByFolder = false }: { filters: Filters; canGroupByFolder?: boolean }) {
  const { q, setQ, type, setType, group, setGroup, types } = filters;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="doc-search" className="text-xs">
            Search documents
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="doc-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or file name" className="h-8 w-60 pl-8" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="doc-group" className="text-xs">
            Group by
          </Label>
          <NativeSelect id="doc-group" value={group} onChange={(e) => setGroup(e.target.value as GroupBy)} className="w-36">
            <option value="none">Nothing</option>
            <option value="type">Type</option>
            {canGroupByFolder ? <option value="folder">Folder</option> : null}
          </NativeSelect>
        </div>
      </div>
      {types.length > 1 ? (
        <div role="group" aria-label="Types" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={type === "all"}
            onClick={() => setType("all")}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors", type === "all" ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary/60")}
          >
            All types
          </button>
          {types.map((t) => (
            <button
              key={t.slug}
              type="button"
              aria-pressed={type === t.slug}
              onClick={() => setType(type === t.slug ? "all" : t.slug)}
              className={cn("rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring", type === t.slug ? "ring-2 ring-primary" : "opacity-90 hover:opacity-100")}
            >
              <TypeBadge slug={t.slug} name={`${t.name} · ${t.count}`} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The rows in sections with a heading and a count (by type, or by folder), each a normal document list. */
export function GroupedDocuments({
  rows,
  group,
  folders,
  viewerIsHr,
  showAudience,
  emptyText,
}: {
  rows: DocumentRow[];
  group: Exclude<GroupBy, "none">;
  folders?: FolderRow[];
  viewerIsHr: boolean;
  showAudience?: boolean;
  emptyText: string;
}) {
  const sections = useMemo(() => {
    const map = new Map<string, { key: string; label: string; slug?: string; rows: DocumentRow[] }>();
    for (const r of rows) {
      const folder = group === "folder" ? folders?.find((f) => f.id === r.folderId) : undefined;
      const key = group === "type" ? r.typeSlug : (folder?.id ?? "none");
      const label = group === "type" ? r.typeName : (folder?.name ?? "No folder");
      const s = map.get(key) ?? { key, label, slug: group === "type" ? r.typeSlug : undefined, rows: [] };
      s.rows.push(r);
      map.set(key, s);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, group, folders]);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <section key={s.key} aria-label={s.label} className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {s.slug ? <TypeBadge slug={s.slug} name={s.label} /> : s.label}
            <span className="text-xs font-normal text-muted-foreground">{s.rows.length}</span>
          </h3>
          <DocumentList rows={s.rows} viewerIsHr={viewerIsHr} showAudience={showAudience} folders={folders} emptyText={emptyText} />
        </section>
      ))}
    </div>
  );
}
