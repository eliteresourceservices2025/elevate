import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Severity } from "../attention";
import { getAttention } from "../feed-queries";
import type { Lens } from "../lens";
import { guarded } from "./guard";

const LOOK: Record<Severity, { Icon: typeof Info; tone: string; label: string }> = {
  urgent: { Icon: Siren, tone: "text-red-600 dark:text-red-400", label: "Urgent" },
  warn: { Icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400", label: "Needs attention" },
  info: { Icon: Info, tone: "text-sky-600 dark:text-sky-400", label: "For your information" },
};

/** What needs eyes now, most urgent first. Plain counts that link to where each is fixed: no names, no private details. */
export async function AttentionFeed({ lens }: { lens: Lens }) {
  return guarded("Needs attention", async () => {
    const items = await getAttention(lens);
    return (
      <section aria-label="Needs attention" className="space-y-2">
        <h2 className="text-lg font-semibold">Needs attention</h2>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            <CheckCircle2 className="size-5 text-green-600" aria-hidden />
            You are all caught up.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const { Icon, tone, label } = LOOK[item.severity];
              return (
                <li key={item.id}>
                  <Link href={item.href} className="flex items-start gap-3 rounded-xl border bg-card p-3 outline-none transition-colors hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                    <Icon className={cn("mt-0.5 size-5 shrink-0", tone)} aria-hidden />
                    <span className="min-w-0">
                      <span className="sr-only">{label}: </span>
                      <span className="block text-sm font-medium">{item.title}</span>
                      {item.detail ? <span className="block text-xs text-muted-foreground">{item.detail}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  });
}
