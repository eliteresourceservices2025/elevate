"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCheck, Clock3 } from "lucide-react";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Button } from "@/components/ui/button";
import { Panel, PanelList, PanelNote } from "./panel";
import { ApprovalRow } from "./approval-row";
import { daysSince } from "../attention";
import { KIND_LABEL, type QueueItem } from "../approvals";

type Filter = "all" | QueueItem["kind"];

/** One compact, actionable inbox for routine approvals. Sensitive reports stay on their own queues. */
export function ApprovalsWorkspace({ items, hoursWaiting }: { items: QueueItem[]; hoursWaiting: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = items.filter((item) => filter === "all" || item.kind === filter);
  const paged = usePaged(visible, filter);
  const counts: Record<Filter, number> = {
    all: items.length,
    time_off: items.filter((item) => item.kind === "time_off").length,
    correction: items.filter((item) => item.kind === "correction").length,
    extra_hours: items.filter((item) => item.kind === "extra_hours").length,
  };
  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-medium"><CheckCheck className="size-4 text-primary" aria-hidden /> Routine requests</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{items.length}</p>
          <p className="text-sm text-muted-foreground">Waiting for your decision across time off, corrections and extra hours.</p>
        </section>
        <Link href="/hours-review" className="rounded-2xl border bg-card p-4 shadow-sm outline-none transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring">
          <p className="flex items-center gap-2 text-sm font-medium"><Clock3 className="size-4 text-primary" aria-hidden /> Weekly hours</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{hoursWaiting}</p>
          <p className="text-sm text-muted-foreground">People whose finished hours still need review or approval.</p>
        </Link>
      </div>

      <nav aria-label="Filter routine approvals" className="flex gap-2 overflow-x-auto pb-1">
        {(["all", "time_off", "correction", "extra_hours"] as const).map((key) => (
          <Button key={key} type="button" size="sm" variant={filter === key ? "default" : "outline"} onClick={() => setFilter(key)}>
            {/* eslint-disable-next-line security/detect-object-injection -- key comes from the fixed tuple above. */}
            {key === "all" ? "All" : KIND_LABEL[key]} <span className="ml-1 tabular-nums">{counts[key]}</span>
          </Button>
        ))}
      </nav>

      <Panel label="Routine approval inbox" title="Waiting for your decision" count={visible.length}>
        {visible.length === 0 ? (
          <PanelNote>Nothing is waiting in this category.</PanelNote>
        ) : (
          <PanelList>
            {paged.rows.map((item) => <ApprovalRow key={item.key} item={item} waitedDays={daysSince(item.createdAt, now)} />)}
          </PanelList>
        )}
      </Panel>
      {visible.length > 0 ? <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="requests" /> : null}
    </div>
  );
}
