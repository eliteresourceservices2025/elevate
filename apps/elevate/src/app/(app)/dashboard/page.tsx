import type { Metadata } from "next";
import Link from "next/link";
import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { DueBadge } from "@/modules/announcements/components/ack-display";
import { listAnnouncements, listMyPending } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const modules = ALL_NAV_ITEMS.filter((i) => i.href !== "/dashboard");
  const [pending, latest] = await Promise.all([listMyPending(), listAnnouncements({ limit: 3 })]);
  const today = todayInZone();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome to ELEVATE</h1>
        <p className="mt-1 text-muted-foreground">Exceptional Support. Elevated Efficiency.</p>
      </div>

      {pending.length > 0 ? (
        <section aria-label="Waiting for you" className="space-y-2">
          <h2 className="text-lg font-semibold">Waiting for you</h2>
          <ul className="space-y-2">
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
      ) : null}

      {latest.length > 0 ? (
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
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map(({ href, label, icon: Icon, description }) => (
          <li key={href}>
            <Link href={href} className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4 text-primary" aria-hidden />
                    {label}
                  </CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
