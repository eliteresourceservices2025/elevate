import Link from "next/link";
import { Download, Monitor } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { PLATFORMS, formatBytes, platformsFor, type Platform } from "../releases-logic";
import type { PublishedRelease } from "../releases-service";

const LABEL: Record<Platform, string> = {
  "windows-x86_64": "Download for Windows",
  "darwin-aarch64": "Download for Apple silicon",
  "darwin-x86_64": "Download for Intel Mac",
};

/**
 * The download buttons. The visitor's computer picks the primary one; a platform with no installer is said to be unavailable rather than
 * linked (no dead link). The link goes to our own signed-in route, never a storage address, and no file name or path is shown.
 */
export function DownloadHero({ os, current, zone }: { os: "windows" | "mac" | "other"; current: PublishedRelease | null; zone: string }) {
  if (!current) return <EmptyState icon={Download} title="The app is not ready to download yet" description="When HR publishes the first version, it appears here." />;
  const shown: Platform[] = os === "other" ? [...PLATFORMS] : platformsFor(os);
  const primary = new Set<Platform>(os === "other" ? [] : platformsFor(os));
  return (
    <section aria-label="Download" className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      {os === "other" ? (
        <p className="flex items-start gap-2 text-sm">
          <Monitor aria-hidden className="mt-0.5 size-4 shrink-0" />
          The app runs on a Windows or Mac work computer. Open this page on that computer to download it.
        </p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {shown.map((platform) => {
          const installer = current.builds.find((b) => b.platform === platform && b.kind === "installer");
          return (
            <li key={platform} className="space-y-2 rounded-xl border p-4">
              {installer ? (
                <>
                  <Link href={`/api/tracker/download/${platform}`} className={cn(buttonVariants({ variant: primary.has(platform) ? "default" : "outline", size: "lg" }), "w-full")}>
                    <Download aria-hidden className="size-4" /> {LABEL[platform]}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    Version {current.version} · {formatInZone(current.publishedAt, zone, "MMM d, yyyy")} · {formatBytes(installer.sizeBytes)}
                  </p>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Check the file</summary>
                    <p className="mt-1">If your IT team wants to check the download, its SHA-256 should be:</p>
                    <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-xs">{installer.sha256}</code>
                  </details>
                </>
              ) : (
                <>
                  <p className="font-medium">{LABEL[platform].replace("Download for ", "")}</p>
                  <p className="text-sm text-muted-foreground">Not available yet.</p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
