"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, FileText, Megaphone, Search, UserRound, UserSearch } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { matchPages, type PageEntry, type SearchHit, type SearchKind } from "@/modules/dashboard/search";
import { searchEverything } from "@/modules/dashboard/search-actions";

const GROUPS: { kind: SearchKind; label: string; Icon: typeof Search }[] = [
  { kind: "page", label: "Pages", Icon: FileText },
  { kind: "person", label: "People", Icon: UserRound },
  { kind: "applicant", label: "Applicants", Icon: UserSearch },
  { kind: "asset", label: "Equipment", Icon: Boxes },
  { kind: "announcement", label: "Announcements", Icon: Megaphone },
];

/**
 * The search box in the header: press Ctrl+K (or ⌘K) anywhere, or use the button. Menu pages are matched on the spot; people,
 * applicants, equipment and announcements come from the server, which applies each person's own access rules.
 */
export function GlobalSearch({ pages }: { pages: PageEntry[] }) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const ticket = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const reset = useCallback(() => {
    setQ("");
    setRemote([]);
    setError(null);
    setActive(0);
    setBusy(false);
    ticket.current += 1;
  }, []);

  // Ask the server a moment after typing stops; an older answer never replaces a newer one.
  useEffect(() => {
    if (q.trim().length < 2) {
      ticket.current += 1;
      return;
    }
    const mine = ++ticket.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const result = await searchEverything({ q });
        if (mine !== ticket.current) return;
        if (result.ok) {
          setRemote(result.data);
          setError(null);
        } else {
          setRemote([]);
          setError(result.error);
        }
      } catch {
        if (mine === ticket.current) setError("Search could not reach ELEVATE. Try again.");
      } finally {
        if (mine === ticket.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const typed = q.trim().length >= 2;
  const hits = useMemo<SearchHit[]>(() => {
    if (!typed) return [];
    const local = matchPages(pages, q).map<SearchHit>((p) => ({ kind: "page", title: p.label, subtitle: p.description, href: p.href }));
    return [...local, ...remote];
  }, [pages, q, remote, typed]);

  const groups = GROUPS.map((g) => ({ ...g, items: hits.filter((h) => h.kind === g.kind) })).filter((g) => g.items.length > 0);
  const flat = groups.flatMap((g) => g.items);
  // Where each group starts in the flat list, so every result knows its own position for the arrow keys.
  const starts = groups.map((_, i) => groups.slice(0, i).reduce((n, g) => n + g.items.length, 0));
  const clamped = Math.min(active, Math.max(flat.length - 1, 0));

  function go(hit: SearchHit) {
    setOpen(false);
    reset();
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((clamped + 1) % Math.max(flat.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((clamped - 1 + flat.length) % Math.max(flat.length, 1));
    } else if (e.key === "Enter" && flat[clamped]) {
      e.preventDefault();
      go(flat[clamped]);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground max-sm:size-8 max-sm:px-0"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search aria-hidden />
        <span className="hidden sm:inline">Search</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[0.65rem] md:inline">Ctrl K</kbd>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent showCloseButton={false} className="top-[12%] translate-y-0 gap-0 p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Search ELEVATE</DialogTitle>
          <DialogDescription className="sr-only">Type at least two letters to find pages, people, equipment and more. Use the arrow keys and Enter to open a result.</DialogDescription>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search pages, people, equipment, applicants…"
              aria-label="Search"
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls={listId}
              aria-activedescendant={flat.length > 0 ? `${listId}-${clamped}` : undefined}
              autoComplete="off"
              spellCheck={false}
              maxLength={60}
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
            {!typed ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">Type at least two letters.</p> : null}
            {typed && error ? <p role="alert" className="px-2 py-6 text-center text-sm text-destructive">{error}</p> : null}
            {typed && !error && flat.length === 0 ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">{busy ? "Searching…" : "Nothing found."}</p> : null}
            {groups.map(({ kind, label, Icon, items }, gi) => (
              <div key={kind} role="group" aria-label={label} className="mb-1">
                <p className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                {items.map((hit, hi) => {
                  // eslint-disable-next-line security/detect-object-injection -- gi is a loop index
                  const mine = starts[gi] + hi;
                  return (
                    <button
                      key={`${kind}-${hit.href}`}
                      id={`${listId}-${mine}`}
                      type="button"
                      role="option"
                      aria-selected={mine === clamped}
                      onMouseMove={() => setActive(mine)}
                      onClick={() => go(hit)}
                      className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm outline-none", mine === clamped ? "bg-secondary" : "hover:bg-secondary/60")}
                    >
                      <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{hit.title}</span>
                        {hit.subtitle ? <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
