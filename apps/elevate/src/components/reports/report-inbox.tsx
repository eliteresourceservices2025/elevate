"use client";

import { ArrowLeft, Inbox, MessageSquare, Paperclip, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ClientPager, usePaged } from "@/components/client-pager";
import { EmptyState } from "@/components/empty-state";
import { StatusChip, type StatusTone } from "@/components/status-chip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export type InboxRow = {
  id: string;
  /** Who it is from (or what it is), the line that stands out. */
  title: string;
  /** What it is about, one line. */
  subtitle: string;
  /** When, already formatted for the viewer. */
  when: string;
  /** For sorting (milliseconds). */
  sortMs: number;
  status: { label: string; tone: StatusTone };
  /** A group the status filter matches (for example "open" or "done"). */
  group: string;
  evidence?: number;
  messages?: number;
  /** Everything a search should find (lower-case is applied for you). */
  search: string;
};

export type InboxFilter = { value: string; label: string };

/**
 * One layout for the pages where people handle reports and requests: a list on the left (who, what, when, status, screenshots, messages) with a search
 * box, a status filter and a sort; the chosen report opens on the right. The choice lives in the address (?id=) so a notification can open the right
 * one. On a phone the report takes the whole screen with a back button. The detail is whatever the page passes (decision buttons, screenshots, thread).
 */
export function ReportInbox({
  rows,
  groups,
  defaultGroup,
  renderDetail,
  emptyTitle,
  emptyText,
  label,
}: {
  rows: InboxRow[];
  /** The status filter choices (besides "All"). */
  groups: InboxFilter[];
  defaultGroup: string;
  renderDetail: (id: string) => ReactNode;
  emptyTitle: string;
  emptyText: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(defaultGroup);
  const [newestFirst, setNewestFirst] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (group === "all" || r.group === group) && (!q || r.search.toLowerCase().includes(q)))
      .sort((a, b) => (newestFirst ? b.sortMs - a.sortMs : a.sortMs - b.sortMs));
  }, [rows, query, group, newestFirst]);
  const paged = usePaged(filtered, `${query}|${group}|${newestFirst}`, 25);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("id", id);
    else next.delete("id");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const open = groups.find((g) => g.value === defaultGroup);

  if (rows.length === 0) return <EmptyState icon={Inbox} title={emptyTitle} description={emptyText} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-52 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={`Search ${label}`} placeholder="Search name or words…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <NativeSelect aria-label="Status" value={group} onChange={(e) => setGroup(e.target.value)} className="w-40">
          <option value="all">All</option>
          {groups.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Sort" value={newestFirst ? "new" : "old"} onChange={(e) => setNewestFirst(e.target.value === "new")} className="w-40">
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
        </NativeSelect>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "report" : "reports"}
          {open && group === "all" ? "" : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className={cn("space-y-2", selected ? "hidden lg:block" : "")}>
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing matches. Change the filter or the search.</p>
          ) : (
            <ul className="space-y-1.5" aria-label={label}>
              {paged.rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => select(r.id)}
                    aria-current={r.id === selectedId ? "true" : undefined}
                    className={cn(
                      "w-full space-y-1 rounded-xl border bg-card p-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                      r.id === selectedId ? "border-primary bg-primary/5" : "",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{r.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{r.when}</span>
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">{r.subtitle}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusChip tone={r.status.tone}>{r.status.label}</StatusChip>
                      {r.evidence ? (
                        <span className="flex items-center gap-1" aria-label={`${r.evidence} screenshots`}>
                          <Paperclip aria-hidden className="size-3" />
                          {r.evidence}
                        </span>
                      ) : null}
                      {r.messages ? (
                        <span className="flex items-center gap-1" aria-label={`${r.messages} messages`}>
                          <MessageSquare aria-hidden className="size-3" />
                          {r.messages}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="reports" />
        </div>

        <div className={cn("min-w-0", selected ? "" : "hidden lg:block")}>
          {selected ? (
            <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
              <button type="button" onClick={() => select(null)} className="flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline lg:hidden">
                <ArrowLeft aria-hidden className="size-4" /> Back to the list
              </button>
              {renderDetail(selected.id)}
            </div>
          ) : (
            <p className="hidden rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground lg:block">Choose a report on the left to read it, see its screenshots and write back.</p>
          )}
        </div>
      </div>
    </div>
  );
}
