"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/form-fields";
import { isValidInitials } from "../constants";

/**
 * Page by page: the signer reads each page of the document and initials it. Opening the document here counts as opening it (the
 * server records it when the file is served). The server checks again that every page number was initialed.
 */
export function InitialsStepper({
  envelopeId,
  pages,
  viewed,
  initials,
  onInitials,
  done,
  onDone,
}: {
  envelopeId: string;
  pages: number;
  viewed: boolean;
  initials: string;
  onInitials: (value: string) => void;
  done: number[];
  onDone: (pages: number[]) => void;
}) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const valid = isValidInitials(initials);
  const finished = done.length === pages;

  const confirm = () => {
    if (!valid || done.includes(page)) return;
    const next = [...done, page].sort((a, b) => a - b);
    onDone(next);
    const open = Array.from({ length: pages }, (_, i) => i + 1).find((n) => !next.includes(n));
    if (open) setPage(open);
  };

  return (
    <div className="space-y-3">
      <div className="max-w-xs">
        <TextField id="initials-text" label="Your initials (2 to 5 letters)" value={initials} onChange={(e) => onInitials(e.target.value.toUpperCase())} maxLength={5} autoComplete="off" />
      </div>
      <p className="text-sm text-muted-foreground">
        Read each page, then initial it. Page {page} of {pages}. {done.length} of {pages} initialed.
      </p>
      <iframe
        key={page}
        title={`Page ${page} of the document`}
        src={`/api/signing/${envelopeId}/document#page=${page}&view=FitH`}
        className="h-[34rem] w-full rounded-xl border bg-white"
        onLoad={() => {
          if (!viewed) router.refresh();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Previous page
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
          Next page
        </Button>
        <Button type="button" size="sm" disabled={!valid || done.includes(page)} onClick={confirm}>
          {done.includes(page) ? `Page ${page} initialed` : `Initial page ${page}`}
        </Button>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Pages initialed">
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <li key={n}>
            <button type="button" onClick={() => setPage(n)} aria-current={n === page} className={`rounded-md border px-2 py-0.5 text-xs ${done.includes(n) ? "border-success/40 bg-success-surface text-success" : "text-muted-foreground"} ${n === page ? "ring-2 ring-primary" : ""}`}>
              {n}
              {done.includes(n) ? " ✓" : ""}
            </button>
          </li>
        ))}
      </ul>
      {finished ? <p className="text-sm text-success">All {pages} pages initialed. You can sign now.</p> : null}
      {!valid ? <p className="text-xs text-muted-foreground">Enter your initials (English letters) to start.</p> : null}
    </div>
  );
}
