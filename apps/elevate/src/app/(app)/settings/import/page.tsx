import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { ImportUploader } from "@/modules/imports/components/import-uploader";
import { listBatches } from "@/modules/imports/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Import from TalentHR" };

const LABEL: Record<string, string> = { preview: "Preview", committed: "Committed", rolled_back: "Rolled back", discarded: "Discarded" };

export default async function ImportPage() {
  const batches = await orNotFound(listBatches());
  return (
    <PageContainer>
      <PageHeader
        title="Import from TalentHR"
        description="Move people from TalentHR into ELEVATE in safe steps: upload, preview, commit, reconcile. Do real imports only in the production system, never in a test or development copy."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Import from TalentHR" }]}
      />
      <ImportUploader />
      <section aria-label="Earlier imports" className="space-y-2">
        <h2 className="text-lg font-semibold">Earlier imports</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing imported yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <Link href={`/settings/import/${b.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                  {b.fileName}
                </Link>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {b.rowCount} rows, {b.createdAt.toISOString().slice(0, 10)}
                  <Badge variant={b.status === "committed" ? "secondary" : "outline"}>{LABEL[b.status] ?? b.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
