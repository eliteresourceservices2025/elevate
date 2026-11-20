import type { Metadata } from "next";
import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { RUN_STATUS_LABELS, STATEMENT_LABELS as S } from "@/modules/payroll/constants";
import { ReleaseStatementsButton } from "@/modules/payroll/components/statements-release";
import { getRunStatements } from "@/modules/payroll/statements-queries";

export const metadata: Metadata = { title: "Contractor payment statements" };

// One run's statements: every contractor's statement to read or download, and the release to the contractors. Opening this page is audited.

export default async function RunStatementsPage({ params }: PageProps<"/payroll/statements/[runId]">) {
  await requireUser();
  const { runId } = await params;
  const view = await orNotFound(getRunStatements(runId)); // authorize("payroll.view") inside
  if (!view) notFound();
  const { run } = view;

  return (
    <PageContainer width="full">
      <PageHeader
        title={`${S.pageTitle}: ${run.periodLabel}`}
        breadcrumbs={[{ label: "Payroll", href: "/payroll" }, { label: S.tab, href: "/payroll/statements" }, { label: run.periodLabel }]}
        description={
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant={run.status === "paid" ? "success" : "info"}>{RUN_STATUS_LABELS[run.status]}</Badge>
            {run.isTest ? <Badge variant="warning">{S.testRun}</Badge> : null}
            {view.releasedAt ? <Badge variant="success">{S.released(view.releasedAt.slice(0, 10))}</Badge> : <Badge variant="outline">{S.notReleased}</Badge>}
          </p>
        }
        actions={
          <>
            <a href={`/api/payroll/statements/${run.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
              <Download className="size-4" aria-hidden />
              {S.downloadAll}
            </a>
            {view.releasedAt === null && !run.isTest ? <ReleaseStatementsButton runId={run.id} count={view.people.length} refusal={view.refusal} /> : null}
          </>
        }
      />
      {run.isTest ? (
        <Alert variant="warning" role="note">
          {S.refusalTest}
        </Alert>
      ) : view.releasedAt ? (
        <Alert variant="success" role="note">
          {S.alreadyReleased}
        </Alert>
      ) : view.refusal ? (
        <Alert variant="info" role="note">
          {view.refusal}
        </Alert>
      ) : (
        <Alert variant="info" role="note">
          {S.readyHint}
        </Alert>
      )}
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>{S.person}</TableHead>
            <TableHead>{S.lines}</TableHead>
            <TableHead className="text-right">{S.net}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.people.map((p) => (
            <TableRow key={p.employeeId}>
              <TableCell label={S.person} className="font-medium">
                {p.name}
              </TableCell>
              <TableCell label={S.lines}>{p.aliases || "-"}</TableCell>
              <TableCell label={S.net} className="text-right tabular-nums">
                {p.net}
              </TableCell>
              <TableCell label="Actions" className="text-right">
                <div className="flex justify-end gap-2">
                  {/* No prefetch: opening a statement is audited, so only a real click may run it. */}
                  <Link href={`/payroll/statements/${run.id}/${p.employeeId}`} prefetch={false} aria-label={`${S.view}: ${p.name}`} className={buttonVariants({ variant: "default", size: "sm" })}>
                    {S.view}
                  </Link>
                  <a href={`/api/payroll/statements/${run.id}/${p.employeeId}`} target="_blank" rel="noreferrer" aria-label={`${S.download}: ${p.name}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {S.download}
                  </a>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PageContainer>
  );
}
