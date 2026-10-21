import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Severity } from "../attention";
import { getAttention } from "../feed-queries";
import type { Lens } from "../lens";
import { guarded } from "./guard";
import { SEVERITY_VARIANT } from "./severity";
import { Panel, PanelList, PanelNote, ROW_LINK } from "./panel";

const LOOK: Record<Severity, { dot: string; label: string; pill: string }> = {
  urgent: { dot: "bg-destructive", label: "Urgent", pill: "Urgent" },
  warn: { dot: "bg-warning", label: "Needs attention", pill: "Review" },
  info: { dot: "bg-info", label: "For your information", pill: "Info" },
};

/** What needs eyes now, most urgent first. Plain counts that link to where each is fixed: no names, no private details. */
export async function AttentionFeed({ lens }: { lens: Lens }) {
  return guarded("Needs attention", async () => {
    const items = await getAttention(lens);
    return (
      <Panel label="Needs attention" title="Needs attention" count={items.length > 0 ? items.length : undefined}>
        {items.length === 0 ? (
          <PanelNote icon={<CheckCircle2 className="size-5 text-success" aria-hidden />}>You are all caught up.</PanelNote>
        ) : (
          <PanelList>
            {items.map((item) => {
              const { dot, label, pill } = LOOK[item.severity];
              return (
                <li key={item.id}>
                  <Link href={item.href} className={cn(ROW_LINK, "items-center")}>
                    <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="sr-only">{label}: </span>
                      <span className="block text-sm font-medium">{item.title}</span>
                      {item.detail ? <span className="block text-xs text-muted-foreground">{item.detail}</span> : null}
                    </span>
                    <Badge variant={SEVERITY_VARIANT[item.severity]} aria-hidden>
                      {pill}
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
