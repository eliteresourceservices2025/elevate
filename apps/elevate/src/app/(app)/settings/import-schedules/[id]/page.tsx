import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { FinishedBatch } from "@/modules/schedule-import/components/import-outcome";
import { PlanView } from "@/modules/schedule-import/components/plan-view";
import { getScheduleImportPlan, getScheduleImportStatus, listAliasTargets } from "@/modules/schedule-import/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Schedule import preview" };

export default async function ScheduleImportPreviewPage({ params }: PageProps<"/settings/import-schedules/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await orNotFound(getScheduleImportPlan(id));
  if (!data) {
    // Applied, discarded or expired: say so instead of "page not found" (this is also what the page shows right after an apply refreshes it).
    const status = await orNotFound(getScheduleImportStatus(id));
    if (!status) notFound();
    return (
      <PageContainer>
        <PageHeader
          title="Schedule import"
          breadcrumbs={[{ label: "Import schedules and clients", href: "/settings/import-schedules" }, { label: "Schedule import" }]}
        />
        <FinishedBatch batchId={id} status={status} />
      </PageContainer>
    );
  }
  const { batch, plan, digest } = data;
  // The choices are only needed (and only loaded) when something on the sheet can be resolved by picking a record.
  const targets = plan.decisions.some((d) => d.kind !== "other") ? await orNotFound(listAliasTargets()) : null;
  return (
    <PageContainer>
      <PageHeader
        title={<>Preview: {batch.fileName}</>}
        description={
          <>
            <p className="mt-1 text-muted-foreground">
              {batch.observations} clocked-in days read, {plan.totals.pairs} people and clients on the sheet: {plan.totals.ready} matched,{" "}
              {plan.totals.needsDecision} need a person.
            </p>
          </>
        }
        breadcrumbs={[{ label: "Import schedules and clients", href: "/settings/import-schedules" }, { label: `Preview: ${batch.fileName}` }]}
      />
      <PlanView key={digest} batchId={batch.id} plan={plan} digest={digest} targets={targets} />
    </PageContainer>
  );
}
