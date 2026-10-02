// Pure rules for assets (Phase 4.3). No database: used by the actions, the pages and the tests.
// ELEVATE tracks equipment only: no prices, values or depreciation (a purchase date is the only money-adjacent field, and it is just a date).

export const ASSET_STATUSES = ["in_stock", "assigned", "repair", "lost", "retired"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const STATUS_LABELS: Record<AssetStatus, string> = { in_stock: "In stock", assigned: "Assigned", repair: "In repair", lost: "Lost", retired: "Retired" };

export const CATEGORIES = ["laptop", "desktop", "monitor", "headset", "phone", "peripheral", "network", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = { laptop: "Laptop", desktop: "Desktop", monitor: "Monitor", headset: "Headset", phone: "Phone", peripheral: "Keyboard, mouse or webcam", network: "Router or network gear", other: "Other" };

export const CONDITIONS = ["new", "good", "fair", "damaged"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABELS: Record<Condition, string> = { new: "New", good: "Good", fair: "Fair", damaged: "Damaged" };

/** Where an item goes when it comes back. "lost" ends the assignment when the item is not recovered (the condition is the last known one). */
export const RETURN_STATUSES = ["in_stock", "repair", "lost", "retired"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** A tag is printed on a label and is the item's address (/assets/<tag>), so it never changes and only uses safe characters. */
export const TAG_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,28}[A-Z0-9]$/;
export const normalizeTag = (raw: string) => raw.trim().toUpperCase();
/** Words that are pages under /assets, so no item can use them as a tag. */
export const RESERVED_TAGS = ["LABELS", "NEW"] as const;
export const isValidTag = (tag: string) => TAG_PATTERN.test(tag) && !(RESERVED_TAGS as readonly string[]).includes(tag);

/** The path a label's QR code points to. Relative, only the tag: no name, serial number or person. */
export const assetPath = (tag: string) => `/assets/${encodeURIComponent(tag)}`;

/** Manual status changes by HR. An assigned item changes only by returning it; a retired item is final. */
const MANUAL: Record<AssetStatus, readonly AssetStatus[]> = {
  in_stock: ["repair", "lost", "retired"],
  assigned: [],
  repair: ["in_stock", "lost", "retired"],
  lost: ["in_stock", "retired"],
  retired: [],
};

export function canSetStatus(from: AssetStatus, to: AssetStatus): boolean {
  return MANUAL[from].includes(to);
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Whether an item may be handed to someone now. One active assignment at a time: it must be back (in stock) first. */
export function assignability(item: { status: AssetStatus; archived: boolean }): Verdict {
  if (item.archived) return { ok: false, reason: "This item is archived." };
  switch (item.status) {
    case "in_stock":
      return { ok: true };
    case "assigned":
      return { ok: false, reason: "This item is already assigned. Record its return first." };
    case "repair":
      return { ok: false, reason: "This item is in repair. Mark it as in stock first." };
    case "lost":
      return { ok: false, reason: "This item is marked lost." };
    case "retired":
      return { ok: false, reason: "This item is retired." };
  }
}

/** Only an item that is not with someone can be archived. */
export function canArchive(item: { status: AssetStatus; archived: boolean }): Verdict {
  if (item.archived) return { ok: false, reason: "This item is already archived." };
  if (item.status === "assigned") return { ok: false, reason: "Record the return before archiving this item." };
  return { ok: true };
}

/** A damaged item coming back should not go straight back to stock: the form defaults to repair. */
export const defaultReturnStatus = (condition: Condition): ReturnStatus => (condition === "damaged" ? "repair" : "in_stock");
