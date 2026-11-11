import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { JibblePreview, JibbleUploadForm } from "@/modules/payroll/components/jibble-import";
import { getImportPage } from "@/modules/payroll/timesheet-queries";

export const metadata: Metadata = { title: "Import a Jibble timesheet" };

// Fill a draft run from a Jibble timesheet file. Preparers only (the query authorizes); a run that is not a draft cannot be filled.

export default async function ImportTimesheetPage({ params }: PageProps<"/payroll/[runId]/import">) {
  await requireUser();
  const { runId } = await params;
  const data = await orNotFound(getImportPage(runId));
  if (!data) notFound();
  const { run, preview } = data;

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Import a Jibble timesheet"
        description={`Fill the run for ${run.periodStart} to ${run.periodEnd} from a Jibble export, then edit anything you need.`}
        breadcrumbs={[{ label: "Payroll", href: "/payroll" }, { label: `${run.periodStart} to ${run.periodEnd}`, href: `/payroll/${run.id}` }, { label: "Import a timesheet" }]}
      />
      {run.status !== "draft" ? (
        <Alert variant="warning" role="note">
          This run is not a draft any more, so it can&apos;t be filled from a timesheet.
        </Alert>
      ) : (
        <div className="space-y-8">
          <section aria-label="Choose the file" className="max-w-2xl space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="text-lg font-semibold">{preview ? "Use a different file" : "1. Choose the file"}</h2>
            <JibbleUploadForm runId={run.id} />
          </section>
          {preview ? (
            <section aria-label="Check and fill" className="space-y-3">
              <h2 className="text-lg font-semibold">2. Check who is who, then fill the run</h2>
              <JibblePreview key={preview.importId} runId={run.id} preview={preview} />
            </section>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
