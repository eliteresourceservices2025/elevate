import { StatusChip } from "@/components/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/time";
import type { AdminRelease } from "../release-queries";
import { formatBytes, type Platform } from "../releases-logic";
import { DeleteDraftButton, PublishButton, WithdrawButton } from "./release-forms";

const PLATFORM_NAME: Record<Platform, string> = { "windows-x86_64": "Windows", "darwin-aarch64": "Mac (Apple silicon)", "darwin-x86_64": "Mac (Intel)" };
const STATUS = {
  draft: { tone: "neutral", label: "Draft" },
  published: { tone: "success", label: "Published" },
  withdrawn: { tone: "danger", label: "Withdrawn" },
} as const;

/** Every release with its status, the platforms that have a build, and the actions that fit its status. */
export function ReleasesTable({ releases, zone }: { releases: AdminRelease[]; zone: string }) {
  if (releases.length === 0) return <p className="text-sm text-muted-foreground">No releases yet. Create a draft, add its builds with the release script, then publish it.</p>;
  return (
    <Table stack>
      <TableHeader>
        <TableRow>
          <TableHead>Version</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Builds</TableHead>
          <TableHead>Published</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {releases.map((r) => {
          const installerBytes = r.builds.filter((b) => b.kind === "installer").map((b) => b.sizeBytes);
          return (
            <TableRow key={r.id}>
              <TableCell label="Version" className="font-medium">
                <span className="font-mono">{r.version}</span> {r.minRequired ? <StatusChip tone="warning">Required</StatusChip> : null}
              </TableCell>
              <TableCell label="Status">
                <StatusChip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusChip>
              </TableCell>
              <TableCell label="Builds">
                {r.platforms.length === 0 ? (
                  <span className="text-muted-foreground">None yet</span>
                ) : (
                  <>
                    {r.platforms.map((p) => PLATFORM_NAME[p]).join(", ")}
                    {installerBytes.length > 0 ? <span className="text-muted-foreground"> · {formatBytes(Math.max(...installerBytes))}</span> : null}
                  </>
                )}
              </TableCell>
              <TableCell label="Published">{r.publishedAt ? formatInZone(r.publishedAt, zone, "MMM d, yyyy") : "Not yet"}</TableCell>
              <TableCell className="space-x-2 text-right">
                {r.status === "draft" ? (
                  <>
                    <PublishButton id={r.id} version={r.version} />
                    <DeleteDraftButton id={r.id} version={r.version} />
                  </>
                ) : null}
                {r.status === "published" ? <WithdrawButton id={r.id} version={r.version} /> : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
