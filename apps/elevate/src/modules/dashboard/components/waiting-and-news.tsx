import Link from "next/link";
import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { DueBadge } from "@/modules/announcements/components/ack-display";
import { listAnnouncements, listMyPending } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";
import { guarded } from "./guard";

/** Policies and announcements that wait for this person's acknowledgment. */
export async function WaitingForYou() {
  return guarded("Waiting for you", async () => {
    const pending = await listMyPending();
    if (pending.length === 0) return null;
    const today = todayInZone();
    return (
      <section aria-label="Waiting for you" className="space-y-2">
        <h2 className="text-lg font-semibold">Waiting for you</h2>
        {/* Nothing waiting is ever hidden: a long list scrolls inside its own box so it cannot push the rest of the page away. */}
        <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-1" tabIndex={pending.length > 5 ? 0 : undefined} aria-label={pending.length > 5 ? "Everything waiting for you (scrolls)" : undefined}>
          {pending.map((p) => (
            <li key={`${p.kind}-${p.versionId ?? p.id}`}>
              <Link href={p.link} className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                <span className="font-medium">{p.title}</span>
                <Badge variant="outline">{p.kind === "policy" ? `Policy, version ${p.version}` : "Announcement"}</Badge>
                <DueBadge due={p.due} dueOn={p.dueOn} today={today} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  });
}

export async function LatestAnnouncements() {
  return guarded("Latest announcements", async () => {
    const latest = await listAnnouncements({ limit: 3 });
    if (latest.length === 0) return null;
    return (
      <section aria-label="Latest announcements" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Latest announcements</h2>
          <Link href="/announcements" className="text-sm text-primary underline-offset-4 hover:underline">
            See all
          </Link>
        </div>
        <ul className="space-y-2">
          {latest.map((a) => (
            <li key={a.id}>
              <Link href={`/announcements/${a.id}`} className="block rounded-xl border bg-card p-3 outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-2 font-medium">
                  {a.pinned ? <Pin className="size-4 text-primary" aria-label="Pinned" /> : null}
                  {a.title}
                </span>
                <span className="text-xs text-muted-foreground">{formatInZone(a.publishedAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  });
}
