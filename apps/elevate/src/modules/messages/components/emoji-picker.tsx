"use client";

import { Search, Smile } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EMOJI_CATEGORIES, readRecentEmoji, rememberEmoji, searchEmoji } from "../emoji";

const PICKER_WIDTH = 320;
const PICKER_HEIGHT = 352;

/**
 * A button that opens the emoji picker: a search box (try "sweet potato"), the emoji you used most recently, and categories.
 * `onPick` gets the chosen one. Closes on a pick, Escape or a click elsewhere. The picker is placed with fixed positioning next to the
 * button (above it, or below when there is no room), so a scrolling message list around the button never clips it.
 */
export function EmojiPicker({ onPick, label = "Add emoji", size = "icon-sm" }: { onPick: (emoji: string) => void; label?: string; size?: "icon" | "icon-sm" }) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("recent");
  const root = useRef<HTMLSpanElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const open = style !== null;

  function toggle() {
    if (open) return setStyle(null);
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const used = readRecentEmoji();
    setRecent(used);
    setCategory(used.length > 0 ? "recent" : EMOJI_CATEGORIES[0].id);
    setQuery("");
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PICKER_WIDTH - 8));
    const room = rect.top > PICKER_HEIGHT + 16;
    setStyle(room ? { position: "fixed", left, bottom: window.innerHeight - rect.top + 4 } : { position: "fixed", left, top: rect.bottom + 4 });
  }

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setStyle(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setStyle(null);
    const onResize = () => setStyle(null);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const searching = query.trim().length > 0;
  const shown = useMemo(() => {
    if (searching) return searchEmoji(query);
    if (category === "recent") return recent;
    return EMOJI_CATEGORIES.find((c) => c.id === category)?.emojis ?? [];
  }, [searching, query, category, recent]);

  function pick(emoji: string) {
    setRecent(rememberEmoji(emoji));
    onPick(emoji);
    setStyle(null);
  }

  return (
    <span ref={root} className="inline-flex">
      <Button type="button" variant="ghost" size={size} aria-label={label} aria-expanded={open} onClick={toggle}>
        <Smile aria-hidden />
      </Button>
      {open ? (
        <div role="dialog" aria-label="Emoji" style={style ?? undefined} className="z-50 flex w-80 flex-col gap-2 rounded-xl border bg-popover p-2 shadow-lg" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}>
          <div className="relative">
            <label htmlFor="emoji-search" className="sr-only">
              Search emoji
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="emoji-search" ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, for example sweet potato" autoComplete="off" className="h-8 pl-8 text-sm" />
          </div>
          {!searching ? (
            <div className="flex gap-0.5 overflow-x-auto" role="tablist" aria-label="Emoji categories">
              {recent.length > 0 ? <CategoryTab id="recent" icon="🕘" label="Recently used" active={category === "recent"} onSelect={setCategory} /> : null}
              {EMOJI_CATEGORIES.map((c) => (
                <CategoryTab key={c.id} id={c.id} icon={c.icon} label={c.label} active={category === c.id} onSelect={setCategory} />
              ))}
            </div>
          ) : null}
          <p className="px-1 text-xs font-medium text-muted-foreground">{searching ? `Results for "${query.trim()}"` : category === "recent" ? "Recently used" : (EMOJI_CATEGORIES.find((c) => c.id === category)?.label ?? "")}</p>
          <div className="grid max-h-[220px] min-h-[220px] grid-cols-8 content-start gap-0.5 overflow-y-auto" role="group" aria-label="Emoji">
            {shown.map((e, i) => (
              <button
                key={`${e}-${i}`}
                type="button"
                onClick={() => pick(e)}
                className="flex h-8 items-center justify-center rounded-md text-lg outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label={`Emoji ${e}`}
              >
                {e}
              </button>
            ))}
            {shown.length === 0 ? <p className="col-span-8 p-3 text-center text-sm text-muted-foreground">{searching ? "No emoji match. Try another word." : "Nothing here yet."}</p> : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}

function CategoryTab({ id, icon, label, active, onSelect }: { id: string; icon: string; label: string; active: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={() => onSelect(id)}
      className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50", active && "bg-secondary")}
    >
      {icon}
    </button>
  );
}
