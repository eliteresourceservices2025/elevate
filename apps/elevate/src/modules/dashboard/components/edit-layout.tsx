"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { TileLayout } from "../bento-tiles";
import { resetDashboardLayout, saveDashboardLayout } from "../layout-actions";
import type { Lens } from "../lens";

export type EditableTile = { id: string; label: string };

/** "Edit layout": hide tiles and put the rest in the order you like, for this view only. A preference, never a permission. */
export function EditLayout({ view, tiles, layout }: { view: Lens; tiles: EditableTile[]; layout: TileLayout | null }) {
  return (
    <FormDialog label="Edit layout" title="Edit layout" description="Choose which tiles show and in what order. This is only your preference: it never changes what you can see or do." variant="outline" size="lg">
      <LayoutForm view={view} tiles={tiles} layout={layout} />
    </FormDialog>
  );
}

/** The tile ids in the order the person sees them: their saved order first (known ids only, once each), then the rest in default order. */
function startingOrder(tiles: EditableTile[], layout: TileLayout | null): string[] {
  const known = new Set(tiles.map((t) => t.id));
  const first = [...new Set((layout?.order ?? []).filter((id) => known.has(id)))];
  return [...first, ...tiles.map((t) => t.id).filter((id) => !first.includes(id))];
}

function LayoutForm({ view, tiles, layout }: { view: Lens; tiles: EditableTile[]; layout: TileLayout | null }) {
  const dialog = useFormDialog();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const labels = new Map(tiles.map((t) => [t.id, t.label]));
  const [order, setOrder] = useState(() => startingOrder(tiles, layout));
  const [hidden, setHidden] = useState(() => new Set((layout?.hidden ?? []).filter((id) => labels.has(id))));

  const move = (index: number, by: -1 | 1) =>
    setOrder((current) => {
      const next = [...current];
      const to = index + by;
      if (to < 0 || to >= next.length) return current;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  const toggle = (id: string, show: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (show) next.delete(id);
      else next.add(id);
      return next;
    });

  const shown = order.filter((id) => !hidden.has(id)).length;

  function save() {
    if (shown === 0) return void toast.error("Keep at least one tile showing.");
    startTransition(async () => {
      const result = await saveDashboardLayout({ view, hidden: [...hidden], order });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Layout saved.");
      router.refresh();
      dialog?.close(true);
    });
  }

  function reset() {
    startTransition(async () => {
      const result = await resetDashboardLayout({ view });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Layout reset.");
      router.refresh();
      dialog?.close(true);
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-lg border">
        {order.map((id, i) => {
          const label = labels.get(id) ?? id;
          return (
            <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Checkbox id={`show-${id}`} checked={!hidden.has(id)} onCheckedChange={(checked) => toggle(id, checked === true)} />
              <label htmlFor={`show-${id}`} className="min-w-0 flex-1 truncate">
                {label}
              </label>
              <Button type="button" variant="ghost" size="icon" aria-label={`Move ${label} up`} disabled={i === 0 || pending} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Move ${label} down`} disabled={i === order.length - 1 || pending} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
          Reset to default
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          Save layout
        </Button>
      </div>
    </div>
  );
}
