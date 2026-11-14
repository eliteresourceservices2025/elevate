"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { BulkAction, BulkResult } from "@/lib/bulk";
import { cn } from "@/lib/utils";
import { useRun } from "@/modules/recruiting/components/use-run";

// Select one or many, then act: a checkbox on every row, "select all" in the header, a Bulk actions bar, and the same actions under each
// row. Every action asks first (the confirmation lists what will change and what will be skipped, and why), then says what it did.
// The server page passes plain items (id, label, which actions fit) and the server actions; the server decides again on every call.

export type BulkItem = { id: string; label: string; actions: BulkAction[]; /** Why nothing can be done to the row (the checkbox tooltip). */ whyNot?: string | null; /** Why each action does not fit the row. */ why?: Partial<Record<BulkAction, string>> };
export type BulkHandler = (input: { ids: string[]; reason?: string }) => Promise<{ ok: boolean; error?: string; data?: BulkResult }>;
export type BulkConfig = {
  noun: { one: string; many: string };
  /** The actions this person may do (an action without a handler is not offered). */
  handlers: Partial<Record<BulkAction, BulkHandler>>;
  /** Whether the change history wants a reason, and whether it is required. */
  reason?: Partial<Record<BulkAction, "required" | "optional">>;
  /** Said under the list in the delete confirmation. */
  deleteNote: string;
};

type Ctx = {
  items: Map<string, BulkItem>;
  selected: ReadonlySet<string>;
  selectable: string[];
  config: BulkConfig;
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
  request: (action: BulkAction, ids: string[]) => void;
};

const BulkContext = createContext<Ctx | null>(null);

function useBulk(): Ctx {
  const ctx = useContext(BulkContext);
  if (!ctx) throw new Error("Bulk select pieces must sit inside <BulkSelection>");
  return ctx;
}

const VERB: Record<BulkAction, { menu: string; row: string; title: (n: string) => string; confirm: (n: string) => string; done: string; tone: "danger" | "default" }> = {
  delete: { menu: "Delete for good", row: "Delete for good", title: (n) => `Delete ${n} for good?`, confirm: (n) => `Delete ${n}`, done: "Deleted", tone: "danger" },
  archive: { menu: "Archive", row: "Archive", title: (n) => `Archive ${n}?`, confirm: (n) => `Archive ${n}`, done: "Archived", tone: "default" },
  restore: { menu: "Restore", row: "Restore", title: (n) => `Restore ${n}?`, confirm: (n) => `Restore ${n}`, done: "Restored", tone: "default" },
};

const count = (n: number, noun: { one: string; many: string }) => `${n} ${n === 1 ? noun.one : noun.many}`;

export function BulkSelection({ items, config, children }: { items: BulkItem[]; config: BulkConfig; children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<{ action: BulkAction; ids: string[] } | null>(null);
  const map = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selectable = useMemo(() => items.filter((i) => i.actions.length > 0).map((i) => i.id), [items]);

  const toggle = useCallback((id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id]))), []);
  const toggleAll = useCallback(() => setSelected((s) => (selectable.every((id) => s.has(id)) ? new Set() : new Set(selectable))), [selectable]);
  const clear = useCallback(() => setSelected(new Set()), []);
  const request = useCallback((action: BulkAction, ids: string[]) => setPending({ action, ids }), []);

  const value = useMemo<Ctx>(() => ({ items: map, selected, selectable, config, toggle, toggleAll, clear, request }), [map, selected, selectable, config, toggle, toggleAll, clear, request]);

  return (
    <BulkContext.Provider value={value}>
      {children}
      {pending ? (
        <FormDialog
          label="Confirm"
          title={VERB[pending.action].title(count(pending.ids.length, config.noun))}
          open
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          hideTrigger
        >
          <ConfirmBody
            action={pending.action}
            ids={pending.ids}
            onDone={(doneIds) => {
              setSelected((s) => new Set([...s].filter((id) => !doneIds.includes(id))));
              setPending(null);
            }}
          />
        </FormDialog>
      ) : null}
    </BulkContext.Provider>
  );
}

function ConfirmBody({ action, ids, onDone }: { action: BulkAction; ids: string[]; onDone: (done: string[]) => void }) {
  const { items, config } = useBulk();
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [reason, setReason] = useState("");
  const verb = VERB[action];
  const applicable = ids.filter((id) => items.get(id)?.actions.includes(action));
  const skipped = ids.filter((id) => !applicable.includes(id));
  const reasonMode = config.reason?.[action];
  const handler = config.handlers[action];
  const listed = applicable.slice(0, 6).map((id) => items.get(id)?.label ?? id);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!handler || applicable.length === 0) return;
        run(
          () => handler({ ids: applicable, ...(reasonMode ? { reason } : {}) }),
          (data) => {
            const done = data?.done.length ?? 0;
            const left = data?.skipped.length ?? 0;
            return `${verb.done} ${count(done, config.noun)}.${left > 0 ? ` ${left} skipped: ${data!.skipped[0].why}` : ""}`;
          },
          (data) => {
            dialog?.close(true);
            onDone(data?.done ?? []);
          },
        );
      }}
    >
      {applicable.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {listed.map((label) => (
            <li key={label}>{label}</li>
          ))}
          {applicable.length > listed.length ? <li>and {applicable.length - listed.length} more</li> : null}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing selected can be done this way.</p>
      )}
      {skipped.length > 0 ? (
        <div className="rounded-lg border bg-muted/50 p-3 text-sm">
          <p className="font-medium">{count(skipped.length, config.noun)} will be skipped:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {skipped.slice(0, 4).map((id) => (
              <li key={id}>
                {items.get(id)?.label ?? id}: {items.get(id)?.why?.[action] ?? items.get(id)?.whyNot ?? "this can't be done to it"}
              </li>
            ))}
            {skipped.length > 4 ? <li>and {skipped.length - 4} more</li> : null}
          </ul>
        </div>
      ) : null}
      {action === "delete" ? <p className="text-sm text-muted-foreground">This cannot be undone. {config.deleteNote}</p> : null}
      {reasonMode ? (
        <div className="space-y-1">
          <Label htmlFor="bulk-reason">Reason{reasonMode === "optional" ? " (optional)" : ""}</Label>
          <Textarea id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} required={reasonMode === "required"} />
          <p className="text-xs text-muted-foreground">Kept in the change history. Don&apos;t write client or patient details.</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={verb.tone === "danger" ? "destructive" : "default"} disabled={pending || applicable.length === 0}>
          {verb.confirm(count(applicable.length, config.noun))}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => dialog?.close()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The checkbox in a row. Off, with the reason as its tooltip, when nothing can be done to the row. */
export function RowCheckbox({ id }: { id: string }) {
  const { items, selected, toggle } = useBulk();
  const item = items.get(id);
  if (!item) return null;
  const off = item.actions.length === 0;
  return (
    <span title={off ? (item.whyNot ?? undefined) : undefined} className="relative z-10 inline-flex">
      <Checkbox checked={selected.has(id)} onCheckedChange={() => toggle(id)} disabled={off} aria-label={`Select ${item.label}`} />
    </span>
  );
}

/** The checkbox in the header: selects every row that can be acted on; half-ticked when only some are. */
export function SelectAllCheckbox({ label }: { label: string }) {
  const { selected, selectable, toggleAll } = useBulk();
  const some = selectable.some((id) => selected.has(id));
  const all = selectable.length > 0 && selectable.every((id) => selected.has(id));
  return <Checkbox checked={all} indeterminate={some && !all} onCheckedChange={toggleAll} disabled={selectable.length === 0} aria-label={label} />;
}

/** "Bulk actions" menu, Apply, and how many are selected. Offers only actions this person may do and at least one selected row fits. */
export function BulkBar({ className }: { className?: string }) {
  const { items, selected, config, request } = useBulk();
  const [action, setAction] = useState<BulkAction | "">("");
  const chosen = [...selected];
  const offered = (["restore", "archive", "delete"] as const).filter((a) => config.handlers[a]);
  const fits = (a: BulkAction) => chosen.some((id) => items.get(id)?.actions.includes(a));
  const effective = action !== "" && fits(action) ? action : "";
  return (
    <div role="region" aria-label="Selection" className={cn("flex flex-wrap items-center gap-2", className)}>
      <label className="sr-only" htmlFor="bulk-action">
        Bulk actions
      </label>
      <NativeSelect id="bulk-action" value={effective} onChange={(e) => setAction(e.target.value as BulkAction | "")} className="w-auto min-w-44">
        <option value="">Bulk actions</option>
        {offered.map((a) => (
          <option key={a} value={a} disabled={!fits(a)}>
            {VERB[a].menu}
          </option>
        ))}
      </NativeSelect>
      <Button type="button" variant="outline" disabled={effective === "" || chosen.length === 0} onClick={() => effective !== "" && request(effective, chosen)}>
        Apply
      </Button>
      <span aria-live="polite" className="text-sm text-muted-foreground">
        {chosen.length > 0 ? `${count(chosen.length, config.noun)} selected` : ""}
      </span>
    </div>
  );
}

/**
 * The actions under a row's first cell: the server's own links (Open, Download PDF) as children, then the list actions that fit this row and this
 * person's rights. Shown on hover and on keyboard focus; always shown on a touch screen. Put `group/row` on the row.
 */
export function RowActions({ id, children }: { id: string; children?: ReactNode }) {
  const { items, config, request } = useBulk();
  const item = items.get(id);
  const mine = (item?.actions ?? []).filter((a) => config.handlers[a]);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal text-muted-foreground transition-opacity focus-within:opacity-100 md:opacity-0 md:group-hover/row:opacity-100 pointer-coarse:opacity-100">
      {children}
      {mine.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => request(a, [id])}
          className={cn("relative z-10 inline-flex min-h-6 items-center underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-9", a === "delete" ? "text-destructive" : "text-primary")}
        >
          {VERB[a].row}
        </button>
      ))}
    </div>
  );
}
