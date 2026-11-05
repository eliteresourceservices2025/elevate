import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { RUN_STATUS_LABELS } from "@/modules/payroll/constants";
import { ApprovalBar } from "@/modules/payroll/components/approval-bar";
import { RunChecks } from "@/modules/payroll/components/run-checks";
import { CancelRunDialog, UsdRateDialog } from "@/modules/payroll/components/run-dialogs";
import { RefreshSuggestionsButton, UnassignedSuggestions } from "@/modules/payroll/components/suggestion-controls";
import { RunTotals } from "@/modules/payroll/components/run-totals";
import { Worksheet } from "@/modules/payroll/components/worksheet";
import { PaymentsPanel } from "@/modules/payroll/components/payments-panel";
import { getPayments, getWorksheet } from "@/modules/payroll/queries";
import { payrollToday } from "@/modules/payroll/service";

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
  const payments = run.status === "approved" || run.status === "paid" ? await getPayments(runId) : null;

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
              <RefreshSuggestionsButton runId={run.id} />
              <UsdRateDialog runId={run.id} current={run.usdRate} />
              <CancelRunDialog runId={run.id} />
            </>
          ) : undefined
        }
      />
      {run.status === "draft" || run.status === "in_review" ? (
        <RunChecks
          blocking={sheet.checks.blocking}
          warnings={sheet.checks.warnings}
          unreadableCount={sheet.unreadableCount}
          stage={run.status === "draft" ? "draft" : "review"}
          checksAreMine={sheet.checksAreMine}
        />
      ) : null}
      <UnassignedSuggestions sheet={sheet} canPrepare={sheet.canPrepare} />
      <Worksheet sheet={sheet} lines={shown} canPrepare={sheet.canPrepare} />
      <PagerLinks info={info} basePath={`/payroll/${run.id}`} defaultSize={DEFAULT_SIZE} label="lines" />
      <RunTotals sheet={sheet} />
      <ApprovalBar
        runId={run.id}
        status={run.status}
        canPrepare={sheet.canPrepare}
        canApprove={sheet.canApprove}
        blocking={sheet.checks.blocking.length + sheet.unreadableCount}
        expectedHash={sheet.expectedHash}
        refusal={sheet.approvalRefusal}
        sentBackNote={sheet.sentBackNote}
        lineCount={sheet.lines.length}
      />
      {payments ? <PaymentsPanel view={payments} today={payrollToday()} /> : null}
    </PageContainer>
  );
}
