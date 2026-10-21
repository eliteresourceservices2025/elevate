import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Severity } from "../attention";
import type { Lens } from "../lens";
import { getRisks } from "../panel-queries";
import { guarded } from "./guard";
import { Panel, PanelList, PanelNote, ROW_LINK } from "./panel";

const LOOK: Record<Severity, { variant: "destructive" | "warning" | "info"; label: string }> = {
  urgent: { variant: "destructive", label: "Urgent" },
  warn: { variant: "warning", label: "Watch" },
  info: { variant: "info", label: "Heads up" },
};

/** Early warnings about teams and operations. Each card states the rule behind it, so nothing is a black box. */
export async function RiskCards({ lens }: { lens: Lens }) {
  return guarded("Early warnings", async () => {
    const { cards, ready } = await getRisks(lens);
    if (lens === "my_work") return null;
    return (
      <Panel
        label="Early warnings"
        title={
          <>
            <ShieldAlert className="size-5 text-primary" aria-hidden />
            Early warnings
          </>
        }
      >
        {!ready ? (
          <PanelNote>Trends need a night of history. They appear after ELEVATE&apos;s first nightly summary runs.</PanelNote>
        ) : cards.length === 0 ? (
          <PanelNote>Nothing is trending the wrong way. Attendance, turnover, hiring, payroll and leave are checked each time you open this page.</PanelNote>
        ) : (
          <PanelList>
            {cards.map((card) => {
              const { variant, label } = LOOK[card.severity];
              return (
                <li key={card.id}>
                  <Link href={card.href} className={ROW_LINK}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        <span className="sr-only">{label}: </span>
                        {card.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        <span className="font-medium">Why you see this: </span>
                        {card.rule}
                      </span>
                    </span>
                    <Badge variant={variant} aria-hidden>
                      {label}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </PanelList>
        )}
      </Panel>
    );
  });
}
