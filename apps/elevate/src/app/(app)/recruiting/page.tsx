/* eslint-disable security/detect-object-injection -- keys are typed stage and status names */
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { paginate, parsePaging } from "@/lib/pagination";
import { formatInZone } from "@/lib/time";
import { CalendarCard } from "@/modules/recruiting/components/calendar-card";
import { FormDialog } from "@/components/form-dialog";
import { RetentionForm } from "@/modules/recruiting/components/opening-forms";
import { STAGE_LABELS, STAGES } from "@/modules/recruiting/constants";
import { getCalendarCard, getRecruitingSummary, getRetentionView, listOpenings } from "@/modules/recruiting/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Recruiting" };

const STATUS_LABEL: Record<string, string> = { draft: "Draft", open: "Open", closed: "Closed" };

export default async function RecruitingPage({ searchParams }: PageProps<"/recruiting">) {
  const user = await requireUser();
  const sp = await searchParams;
  const canView = scopeFor(user, "recruiting.view") !== null;
  const canManage = scopeFor(user, "recruiting.manage_openings") !== null;
  if (!canView && !scopeFor(user, "recruiting.summary")) notFound(); // nothing here for this role: same answer as a missing page
  const summary = scopeFor(user, "recruiting.summary") ? await orNotFound(getRecruitingSummary()) : null;
  const openings = canView ? await orNotFound(listOpenings()) : null;
  const calendar = scopeFor(user, "recruiting.connect_calendar") ? await orNotFound(getCalendarCard()) : null;
  const retention = scopeFor(user, "recruiting.manage_retention") ? await orNotFound(getRetentionView()) : null;
  const paging = parsePaging({ page: sp.page, size: sp.size }, 10);
  const page = openings ? paginate(openings.rows, paging.page, paging.pageSize) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Recruiting"
        description="Jobs, applicants, interviews and scorecards. Applicants are kept apart from people records until they are hired."
        actions={
          <>
            <a href="/careers" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
              View careers page <ExternalLink aria-hidden /> <span className="sr-only">(opens in a new tab)</span>
            </a>
            {scopeFor(user, "recruiting.manage_careers_page") ? (
              <Link href="/recruiting/careers-page" className={buttonVariants({ variant: "outline" })}>
                Edit careers page
              </Link>
            ) : null}
            {retention ? (
              <FormDialog label="Applicant data retention" title="Applicant data retention" variant="outline" size="lg">
                <RetentionForm
                  initial={{
                    enabled: retention.retentionEnabled,
                    rejectedMonths: retention.rejectedMonths,
                    withdrawnMonths: retention.withdrawnMonths,
                  }}
                />
              </FormDialog>
            ) : null}
            {canManage ? (
              <Link href="/recruiting/new" className={buttonVariants()}>
                New job
              </Link>
            ) : null}
          </>
        }
      />

      {summary ? (
        <section aria-label="Summary" className="space-y-2">
          <dl className="grid gap-3 sm:grid-cols-4">
            {(
              [
                ["Open jobs", summary.openJobs],
                ["Applications, last 30 days", summary.applicationsLast30Days],
                ["Hired, last 90 days", summary.hiredLast90Days],
                ["In the pipeline", STAGES.filter((s) => s !== "hired" && s !== "rejected").reduce((n, s) => n + summary.counts[s], 0)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-2xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {!canView ? <p className="text-xs text-muted-foreground">You see counts only. Names and details are for the hiring team.</p> : null}
        </section>
      ) : null}

      {openings && page ? (
        <section aria-label="Jobs" className="space-y-2">
          <h2 className="text-lg font-semibold">Jobs</h2>
          {openings.scope === "team" ? <p className="text-sm text-muted-foreground">Jobs you are on the hiring team for.</p> : null}
          {openings.rows.length === 0 ? (
            <p className="text-muted-foreground">{canManage ? "No jobs yet. Create one to start receiving applications." : "You are not on the hiring team of any job."}</p>
          ) : (
            <>
              <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">Applicants</TableHead>
                      <TableHead className="text-right">New this week</TableHead>
                      <TableHead>Stages</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.rows.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">
                          <Link href={`/recruiting/${o.id}`} className="text-primary underline-offset-4 hover:underline">
                            {o.title}
                          </Link>
                          {o.openedAt ? <span className="block text-xs font-normal text-muted-foreground">Opened {formatInZone(o.openedAt, undefined, "MMM d, yyyy")}</span> : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={o.status === "open" ? "default" : "secondary"}>{STATUS_LABEL[o.status] ?? o.status}</Badge>
                        </TableCell>
                        <TableCell>{o.team ?? "-"}</TableCell>
                        <TableCell className="text-right">{o.total}</TableCell>
                        <TableCell className="text-right">{o.newThisWeek || "-"}</TableCell>
                        <TableCell className="space-x-1 text-xs">
                          {STAGES.filter((s) => o.counts[s] > 0).map((s) => (
                            <Badge key={s} variant="outline">
                              {STAGE_LABELS[s]} {o.counts[s]}
                            </Badge>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PagerLinks info={page.info} basePath="/recruiting" defaultSize={10} label="jobs" />
            </>
          )}
        </section>
      ) : null}

      {scopeFor(user, "offers.manage_templates") ? (
        <p className="text-sm">
          <Link href="/recruiting/offer-templates" className="font-medium text-primary underline-offset-4 hover:underline">
            Offer templates
          </Link>
          <span className="text-muted-foreground">: the letters recruiters send for signature.</span>
        </p>
      ) : null}

      {calendar ? <CalendarCard status={calendar} flash={typeof sp.calendar === "string" ? sp.calendar : undefined} /> : null}

      <p className="text-xs text-muted-foreground">
        The public job list is at{" "}
        <a href="/careers" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
          /careers
        </a>{" "}
        (opens in a new tab).{scopeFor(user, "recruiting.manage_careers_page") ? (
          <>
            {" "}
            <Link href="/recruiting/careers-page" className="text-primary underline-offset-4 hover:underline">
              Edit the careers page
            </Link>{" "}
            (title, introduction and banner).
          </>
        ) : null}
      </p>
    </PageContainer>
  );
}
