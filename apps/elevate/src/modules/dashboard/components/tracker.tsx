import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { todayInZone } from "@/modules/org/service";
import { getTracker } from "../panel-queries";
import { percentDone, whenLabel, type TrackerCase } from "../tracker";
import { guarded } from "./guard";
import { Panel } from "./panel";

function CaseList({ kind, cases, total, empty }: { kind: "onboarding" | "offboarding"; cases: TrackerCase[]; total: number; empty: string }) {
  const today = todayInZone();
  const base = `/${kind}`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 px-5 pt-1 pb-2">
        <h3 className="text-sm font-semibold">
          {kind === "onboarding" ? "Onboarding" : "Offboarding"} <span className="font-normal text-muted-foreground">({total})</span>
        </h3>
        <Link href={base} className="text-xs text-primary underline-offset-4 hover:underline">
          See all
        </Link>
      </div>
      {cases.length === 0 ? (
        <p className="px-5 pb-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/70 border-t border-border/70">
          {cases.map((c) => {
            const pct = percentDone(c.done, c.total);
            return (
              <li key={c.id}>
                <Link href={`${base}/${c.id}`} className="block px-5 py-3 outline-none transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{whenLabel(kind, c.date, today)}</span>
                  </span>
                  <span className="mt-2 flex items-center gap-2">
                    <span role="progressbar" aria-label={`${c.name}: ${c.done} of ${c.total} tasks done`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                      {c.done}/{c.total}
                    </span>
                  </span>
                  {c.overdue > 0 || (kind === "offboarding" && !c.accessRemoved) ? (
                    <span className="mt-1.5 flex flex-wrap gap-x-3 text-xs">
                      {c.overdue > 0 ? <span className="font-medium text-warning">{c.overdue} required {c.overdue === 1 ? "task" : "tasks"} overdue</span> : null}
                      {kind === "offboarding" && !c.accessRemoved ? <span className="text-muted-foreground">Access not removed yet</span> : null}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** New hires and leavers in progress: how far along each checklist is, what is overdue, and when the person starts or leaves. */
export async function Tracker() {
  return guarded("Onboarding and offboarding", async () => {
    const t = await getTracker();
    if (!t) return null;
    return (
      <Panel
        label="Onboarding and offboarding"
        title={
          <>
            <ClipboardCheck className="size-5 text-primary" aria-hidden />
            Onboarding and offboarding
          </>
        }
      >
        <div className="grid gap-2 pb-2 sm:grid-cols-2 sm:divide-x sm:divide-border/70">
          <CaseList kind="onboarding" cases={t.onboarding} total={t.onboardingTotal} empty="Nobody is being onboarded." />
          <CaseList kind="offboarding" cases={t.offboarding} total={t.offboardingTotal} empty="Nobody is leaving." />
        </div>
      </Panel>
    );
  });
}
