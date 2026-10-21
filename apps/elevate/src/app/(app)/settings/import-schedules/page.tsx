import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { RememberedMatches } from "@/modules/schedule-import/components/remembered-matches";
import { SheetUploader } from "@/modules/schedule-import/components/sheet-uploader";
import { listAliases, listScheduleImports } from "@/modules/schedule-import/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Import schedules and clients" };

export default async function ImportSchedulesPage() {
  const batches = await orNotFound(listScheduleImports());
  const aliases = await orNotFound(listAliases());
  return (
    <PageContainer>
      <PageHeader
        title="Import schedules and clients"
        description="Upload the attendance sheet and see who works for which client, on which shift and in which time zone, compared with what ELEVATE holds. This step only shows a preview, and you choose what to apply. Hours are never read from the sheet."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Import schedules and clients" }]}
      />
      <SheetUploader />
      <section aria-label="Earlier uploads" className="space-y-2">
        <h2 className="text-lg font-semibold">Earlier uploads</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing uploaded yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                {b.status === "preview" ? (
                  <Link href={`/settings/import-schedules/${b.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {b.fileName}
                  </Link>
                ) : (
                  <span className="font-medium text-muted-foreground">{b.fileName}</span>
                )}
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {b.pairCount} people and clients, {b.createdAt.toISOString().slice(0, 10)}
                  <Badge variant={b.status === "applied" ? "secondary" : "outline"}>{b.status === "preview" ? "Preview" : b.status === "applied" ? "Applied" : "Discarded"}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <RememberedMatches aliases={aliases} />
    </PageContainer>
  );
}
