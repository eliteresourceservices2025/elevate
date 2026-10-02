"use client";

import { Button } from "@/components/ui/button";
import { assetPath } from "../constants";
import { AssetQr } from "./qr-code";

/** Labels to print: tag, name and QR code. The page chrome (menu, header, buttons) is hidden when printing. */
export function LabelSheet({ items }: { items: { tag: string; name: string }[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Button onClick={() => window.print()} disabled={items.length === 0}>
          Print labels
        </Button>
        <p className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? "label" : "labels"}. In the print window, set margins to default and turn off headers and footers.
        </p>
      </div>
      {items.length === 0 ? <p className="text-sm text-muted-foreground print:hidden">Nothing to print.</p> : null}
      <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(63mm,1fr))] print:gap-0 print:[grid-template-columns:repeat(3,63mm)]">
        {items.map((it) => (
          <li key={it.tag} className="flex h-[38mm] break-inside-avoid items-center gap-3 overflow-hidden rounded-md border border-dashed p-2 print:rounded-none print:border-neutral-300">
            <AssetQr path={assetPath(it.tag)} size={104} label={`QR code for item ${it.tag}`} />
            <div className="min-w-0">
              <p className="font-mono text-base font-bold leading-tight">{it.tag}</p>
              <p className="mt-1 line-clamp-3 text-xs leading-snug">{it.name}</p>
              <p className="mt-1 text-[10px] leading-tight text-muted-foreground">Elite Resource Services</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
