import Link from "next/link";
import { AlertTriangle, Info, ShieldAlert, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Severity } from "../attention";
import type { Lens } from "../lens";
import { getRisks } from "../panel-queries";

const LOOK: Record<Severity, { Icon: typeof Info; tone: string; label: string }> = {
  urgent: { Icon: Siren, tone: "text-red-600 dark:text-red-400", label: "Urgent" },
  warn: { Icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400", label: "Watch" },
  info: { Icon: Info, tone: "text-sky-600 dark:text-sky-400", label: "Heads up" },
};

/** Early warnings about teams and operations. Each card states the rule behind it, so nothing is a black box. */
export async function RiskCards({ lens }: { lens: Lens }) {
  const { cards, ready } = await getRisks(lens);
  if (lens === "my_work") return null;
  return (
    <section aria-label="Early warnings" className="space-y-2">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <ShieldAlert className="size-5 text-primary" aria-hidden />
        Early warnings
      </h2>
      {!ready ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Trends need a night of history. They appear after ELEVATE&apos;s first nightly summary runs.</p>
      ) : cards.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Nothing is trending the wrong way. Attendance, turnover, hiring, payroll and leave are checked each time you open this page.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => {
            const { Icon, tone, label } = LOOK[card.severity];
            return (
              <li key={card.id}>
                <Link href={card.href} className="flex h-full flex-col gap-1.5 rounded-xl border bg-card p-3 outline-none transition-colors hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex items-start gap-2">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden />
                    <span className="text-sm font-medium">
                      <span className="sr-only">{label}: </span>
                      {card.title}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium">Why you see this: </span>
                    {card.rule}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
