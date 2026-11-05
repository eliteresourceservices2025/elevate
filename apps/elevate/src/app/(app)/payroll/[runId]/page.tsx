import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { RUN_STATUS_LABELS } from "@/modules/payroll/constants";
import { RunChecks } from "@/modules/payroll/components/run-checks";
import { CancelRunDialog, UsdRateDialog } from "@/modules/payroll/components/run-dialogs";
import { RunTotals } from "@/modules/payroll/components/run-totals";
import { Worksheet } from "@/modules/payroll/components/worksheet";
import { getWorksheet } from "@/modules/payroll/queries";

export const metadata: Metadata = { title: "Payroll run" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const DEFAULT_SIZE = 50;

export default async function PayrollRunPage({ params, searchParams }: PageProps<"/payroll/[runId]">) {
  await requireUser();
  const { runId } = await params;
  const query = await searchParams;
  const sheet = await orNotFound(getWorksheet(runId)); // authorize("payroll.view") inside
  if (!sheet) notFound();

  const paging = parsePaging({ page: one(query.page), size: one(query.size) }, DEFAULT_SIZE);
  const info = pageInfo(sheet.lines.length, paging.page, paging.pageSize);
  const shown = sheet.lines.slice(info.offset, info.offset + info.pageSize);
  const { run } = sheet;

  return (
    <PageContainer width="canvas">
      <PageHeader
        title={`Pay run ${run.periodStart} to ${run.periodEnd}`}
        breadcrumbs={[{ label: "Payroll", href: "/payroll" }, { label: `${run.periodStart} to ${run.periodEnd}` }]}
        description={
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant={run.status === "draft" ? "outline" : "info"}>{RUN_STATUS_LABELS[run.status]}</Badge>
            <span>Opening this page is written to the audit log. Figures are never sent in notices.</span>
          </p>
        }
        actions={
          sheet.canPrepare && run.status === "draft" ? (
            <>
              <UsdRateDialog runId={run.id} current={run.usdRate} />
              <CancelRunDialog runId={run.id} />
            </>
          ) : undefined
        }
      />
      {run.status === "draft" ? (
        <RunChecks blocking={sheet.checks.blocking} warnings={sheet.checks.warnings} unreadableCount={sheet.unreadableCount} />
      ) : null}
      {sheet.unassigned.length > 0 ? (
        <Alert variant="warning" className="rounded-lg p-3 text-sm">
          Suggested amounts for {sheet.unassigned.map((u) => u.name).join(", ")} are not assigned to a pay line yet.
        </Alert>
      ) : null}
      <Worksheet sheet={sheet} lines={shown} canPrepare={sheet.canPrepare} />
      <PagerLinks info={info} basePath={`/payroll/${run.id}`} defaultSize={DEFAULT_SIZE} label="lines" />
      <RunTotals sheet={sheet} />
    </PageContainer>
  );
}
