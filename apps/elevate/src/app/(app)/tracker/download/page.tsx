import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { DownloadHero } from "@/modules/activity/components/download-hero";
import { EnrollDialog } from "@/modules/activity/components/enroll-dialog";
import { ReleaseList } from "@/modules/activity/components/release-list";
import { getDownloadPage } from "@/modules/activity/release-queries";
import { detectPlatform } from "@/modules/activity/releases-logic";

export const metadata: Metadata = { title: "ELEVATE Tracker App" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

// Everyone signed in (a client guest never gets here: requireUser sends them to Messages). No loading.tsx: orNotFound can call notFound().
export default async function TrackerDownloadPage({ searchParams }: PageProps<"/tracker/download">) {
  await requireUser();
  const params = await searchParams;
  const filter = one(params.filter) === "required" ? "required" : "all";
  const data = await orNotFound(getDownloadPage());
  const os = detectPlatform((await headers()).get("user-agent"));
  const zone = DEFAULT_TIMEZONE;

  return (
    <PageContainer width="wide">
      <PageHeader title="ELEVATE Tracker App" description="Download the app, add your computer, and see what changed in each version." />
      {!data.policy ? (
        <Alert variant="info">
          <AlertDescription>Recording starts only after the monitoring policy is published. You can install the app now; it will not record anything until then.</AlertDescription>
        </Alert>
      ) : null}

      <DownloadHero os={os} current={data.current} zone={zone} />

      <section aria-label="Install in three steps" className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Install in three steps</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Download the app above and open it. Allow it to install.</li>
          <li>
            On a Mac, when asked, allow <strong>Screen Recording</strong> and <strong>Accessibility</strong> in System Settings, then reopen the app. Without them it cannot see which app you use or take the blurred screenshots.
          </li>
          <li>Add this computer with a one-time code, then clock in here as usual. The app records only while you are clocked in, and only the app name.</li>
        </ol>
        <EnrollDialog />
      </section>

      <section aria-label="Your computers" className="space-y-2">
        <h2 className="text-lg font-semibold">Your computers</h2>
        {data.devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No computer added yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {data.devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  {d.name} <span className="text-muted-foreground">({d.os === "macos" ? "macOS" : "Windows"}, version {d.appVersion})</span>
                </span>
                <span className="text-muted-foreground">{d.lastSeenAt ? `Last seen ${formatInZone(d.lastSeenAt, zone, "MMM d, h:mm a")}` : "Not seen yet"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="System requirements" className="text-sm text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">System requirements</h2>
        <p>Windows 10 version 21H2 or newer, or macOS 12 or newer. Need help? Use Contact support from Settings.</p>
      </section>

      <ReleaseList releases={data.releases} filter={filter} zone={zone} />
    </PageContainer>
  );
}
