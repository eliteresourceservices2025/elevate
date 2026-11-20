import Link from "next/link";
import { Camera, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StatusChip } from "@/components/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDateOnly, formatInZone } from "@/lib/time";
import { ForbiddenError } from "@/lib/authz";
import { ActionFailure } from "@/lib/run-action";
import { getMyDayCard, type ShotViewRow } from "../queries";
import { reasonLabel } from "../labels";
import { DayBody } from "./day-body";
import { ShotGallery } from "./shot-gallery";
import { EnrollDialog } from "./enroll-dialog";

const shift = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function Views({ views }: { views: ShotViewRow[] }) {
  return (
    <details className="rounded-xl border bg-card p-3 text-sm">
      <summary className="cursor-pointer font-medium">Who looked at my screenshots</summary>
      {views.length === 0 ? (
        <p className="mt-2 text-muted-foreground">Nobody has opened your screenshots in the last 30 days.</p>
      ) : (
        <ul className="mt-2 divide-y">
          {views.map((v) => (
            <li key={`${v.viewer}-${v.day}-${v.reason}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                {v.viewer} · {reasonLabel(v.reason)}
              </span>
              <span className="text-muted-foreground">
                {formatDateOnly(v.day)}
                {v.count > 1 ? ` · ${v.count} times` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** The signed-in person's own recorded day, on the Attendance page. Shows nothing until a monitoring policy is published. */
export async function MyDayCard({ date }: { date?: string }) {
  let data;
  try {
    data = await getMyDayCard({ date });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ActionFailure) return null; // no people record yet: the page already asks to set it up
    throw error;
  }
  if (!data.policy) return null;
  const { day, zone } = data;
  const prev = shift(data.date, -1);
  const next = shift(data.date, 1);
  const base = "/attendance?tab=mine";

  return (
    <section aria-label="My day" className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">My day in the ELEVATE Tracker App</h2>
          <p className="text-sm text-muted-foreground">What is recorded about you: only the app name and whether you were active. Never window titles, web addresses or keystrokes.</p>
        </div>
        <EnrollDialog variant={data.hasDevice ? "outline" : "default"} />
      </div>

      {!data.hasDevice || !day ? (
        <EmptyState icon={Camera} title="Set up the ELEVATE Tracker App" description="Nothing is recorded yet. Install the app on your work computer and add it with a one-time code." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${base}&day=${prev}`} aria-label="Previous day" className={buttonVariants({ variant: "outline", size: "icon" })}>
              <ChevronLeft aria-hidden />
            </Link>
            <p className="min-w-40 text-center font-medium">{formatDateOnly(data.date)}</p>
            {data.date >= data.today ? (
              <Button variant="outline" size="icon" aria-label="Next day (not available)" disabled>
                <ChevronRight aria-hidden />
              </Button>
            ) : (
              <Link href={`${base}&day=${next}`} aria-label="Next day" className={buttonVariants({ variant: "outline", size: "icon" })}>
                <ChevronRight aria-hidden />
              </Link>
            )}
            <StatusChip tone={day.trackerOnline ? "success" : "neutral"}>{day.trackerOnline ? "App online" : "App not reporting"}</StatusChip>
          </div>
          <DayBody day={day} viewerZone={zone} />
          <section aria-label="Screenshots" className="space-y-2">
            <h3 className="text-sm font-semibold">Screenshots</h3>
            <ShotGallery shots={day.shots} zone={zone} needReason={false} />
          </section>
          <Views views={data.views} />
        </>
      )}
    </section>
  );
}
