import { cn } from "@/lib/utils";

// One look for both pagers (PagerLinks for server lists, ClientPager for lists already in the browser), so a page never shows two
// different pagers. Targets are at least 32 px, 40 px on a phone.
const TARGET = "inline-flex min-h-8 items-center justify-center max-sm:min-h-10";

export const PAGER_BUTTON = cn(TARGET, "rounded-lg border px-3 text-sm hover:bg-secondary/50");
/** Previous or Next when there is nowhere to go. */
export const PAGER_OFF = cn(TARGET, "pointer-events-none rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground");
/** One of the "per page" sizes. */
export const sizeChip = (active: boolean) => cn(TARGET, "min-w-8 rounded-md px-2 text-xs max-sm:min-w-10", active ? "bg-primary text-primary-foreground" : "hover:bg-secondary/50");
