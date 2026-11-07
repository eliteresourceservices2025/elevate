import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/modules/audit/write";
import { PAYSLIP_LABELS as L } from "@/modules/payroll/constants";
import { PayslipDocument } from "@/modules/payroll/components/payslip-document";
import { payslipView } from "@/modules/payroll/payslip";
import { getMyPayslip, PayslipUnreadable } from "@/modules/payroll/payslip-queries";

export const metadata: Metadata = { title: L.pageTitle };

// One payslip on screen. Only the person it belongs to can open it, and only once the run is paid: someone else's run, an unpaid run and a
// run that does not exist all give the same not-found page. Opening it is audited with the run id only (never an amount).

export default async function PayslipPage({ params }: PageProps<"/my-pay/[runId]">) {
  const actor = await requireUser();
  const { runId } = await params;

  let slip: Awaited<ReturnType<typeof getMyPayslip>>;
  try {
    slip = await getMyPayslip(actor, runId);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    if (error instanceof PayslipUnreadable) {
      return (
        <PageContainer width="medium">
          <PageHeader title={L.pageTitle} breadcrumbs={[{ label: L.pageTitle, href: "/my-pay" }, { label: L.documentTitle }]} />
          <Alert variant="destructive">{L.unreadableView}</Alert>
        </PageContainer>
      );
    }
    throw error;
  }
  if (!slip) notFound();

  await writeAudit({ actor, action: "sensitive.view", targetType: "pay_run", targetId: runId, metadata: { fields: ["payslip view"] } });
  const view = payslipView(slip);

  return (
    <PageContainer width="medium">
      <PageHeader
        title={L.pageHeading(view.period)}
        description={L.viewDescription}
        breadcrumbs={[{ label: L.pageTitle, href: "/my-pay" }, { label: view.period }]}
        actions={
          <a href={`/api/payroll/payslips/${runId}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
            <Download aria-hidden className="size-4" />
            {L.download}
          </a>
        }
      />
      <PayslipDocument view={view} />
    </PageContainer>
  );
}
