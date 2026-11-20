import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDateOnly } from "@/lib/time";

export const shiftDay = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Previous and next day as plain links (the address holds the day). Next is a disabled button on today: there is no future to see. */
export function DayPicker({ basePath, date, today }: { basePath: string; date: string; today: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link href={`${basePath}?date=${shiftDay(date, -1)}`} aria-label="Previous day" className={buttonVariants({ variant: "outline", size: "icon" })}>
        <ChevronLeft aria-hidden />
      </Link>
      <p className="min-w-40 text-center font-medium">{formatDateOnly(date)}</p>
      {date >= today ? (
        <Button variant="outline" size="icon" disabled aria-label="Next day (not available yet)">
          <ChevronRight aria-hidden />
        </Button>
      ) : (
        <Link href={`${basePath}?date=${shiftDay(date, 1)}`} aria-label="Next day" className={buttonVariants({ variant: "outline", size: "icon" })}>
          <ChevronRight aria-hidden />
        </Link>
      )}
    </div>
  );
}
