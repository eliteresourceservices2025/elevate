import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// One look for a status wherever it appears (pay runs, invoices): a small dot and the word, in a status colour. The colour carries the
// meaning (neutral, info, success, warning, danger) and the word is always shown too, so colour is never the only signal.

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const VARIANT = { neutral: "outline", info: "info", success: "success", warning: "warning", danger: "destructive" } as const;

export function StatusChip({ tone, children, className }: { tone: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant={VARIANT[tone]} className={cn("gap-1.5", className)}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </Badge>
  );
}
