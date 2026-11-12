import type { Metadata } from "next";
import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { PAYSLIP_LABELS as L, STATEMENT_LABELS as S } from "@/modules/payroll/constants";
import { PayslipDocument } from "@/modules/payroll/components/payslip-document";
import { payslipView } from "@/modules/payroll/payslip";
import { PayslipUnreadable } from "@/modules/payroll/payslip-queries";
import { getStatementForTeam } from "@/modules/payroll/statements-queries";

export const metadata: Metadata = { title: "Contractor payment statement" };

// One contractor's statement on screen for the payroll team, exactly as the contractor sees it. Opening it is audited with the run id only.

export default async function TeamStatementPage({ params }: PageProps<"/payroll/statements/[runId]/[employeeId]">) {
  await requireUser();
  const { runId, employeeId } = await params;

  let slip: Awaited<ReturnType<typeof getStatementForTeam>>;
  try {
    slip = await orNotFound(getStatementForTeam(runId, employeeId)); // authorize("payroll.view") inside
  } catch (error) {
    if (error instanceof PayslipUnreadable) {
      return (
        <PageContainer width="medium">
          <PageHeader title={S.pageTitle} breadcrumbs={[{ label: "Payroll", href: "/payroll" }, { label: S.tab, href: "/payroll/statements" }, { label: L.documentTitle }]} />
          <Alert variant="destructive">{L.unreadableView}</Alert>
        </PageContainer>
      );
    }
    throw error;
  }
  if (!slip) notFound();
  const view = payslipView(slip);

  return (
    <PageContainer width="medium">
      <PageHeader
        title={S.statementFor(view.name)}
        description={view.period}
        breadcrumbs={[{ label: "Payroll", href: "/payroll" }, { label: S.tab, href: "/payroll/statements" }, { label: view.period, href: `/payroll/statements/${runId}` }, { label: view.name }]}
        actions={
          <a href={`/api/payroll/statements/${runId}/${employeeId}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
            <Download aria-hidden className="size-4" />
            {L.download}
          </a>
        }
      />
      <PayslipDocument view={view} />
    </PageContainer>
  );
}
