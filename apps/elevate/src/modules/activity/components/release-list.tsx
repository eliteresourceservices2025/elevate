import Link from "next/link";
import { StatusChip } from "@/components/status-chip";
import { formatInZone } from "@/lib/time";
import type { PublishedRelease } from "../releases-service";

const GROUPS = [
  ["Added", "added"],
  ["Improved", "improved"],
  ["Fixed", "fixed"],
] as const;

/** What changed in each version, newest first: the newest open, older ones folded. Notes are plain text, never HTML. */
export function ReleaseList({ releases, filter, zone }: { releases: PublishedRelease[]; filter: "all" | "required"; zone: string }) {
  const shown = filter === "required" ? releases.filter((r) => r.minRequired) : releases;
  return (
    <section aria-label="Release notes" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">What changed</h2>
        {releases.length > 0 ? (
          <Link href={filter === "required" ? "/tracker/download" : "/tracker/download?filter=required"} className="text-sm underline-offset-4 hover:underline">
            {filter === "required" ? "Show all releases" : "Show only required updates"}
          </Link>
        ) : null}
      </div>
      {releases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No releases yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No required updates.</p>
      ) : (
        <ol className="space-y-3">
          {shown.map((r, i) => (
            <li key={r.id}>
              <details open={i === 0} className="rounded-xl border bg-card p-4">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">Version {r.version}</span>
                  <span className="text-sm text-muted-foreground">{formatInZone(r.publishedAt, zone, "MMM d, yyyy")}</span>
                  {r.minRequired ? <StatusChip tone="warning">Required update</StatusChip> : null}
                </summary>
                <div className="mt-3 space-y-3">
                  {GROUPS.filter(([, key]) => r.notes[key].length > 0).map(([label, key]) => (
                    <div key={key}>
                      <h3 className="text-sm font-semibold">{label}</h3>
                      <ul className="list-disc space-y-1 pl-5 text-sm">
                        {r.notes[key].map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
