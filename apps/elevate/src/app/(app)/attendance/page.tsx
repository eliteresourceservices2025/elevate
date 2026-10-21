import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { TabNav } from "@/components/tab-nav";
import { can, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { listRecordsToClaim } from "@/modules/people/duplicates-queries";
import { MyTimeOverview } from "@/modules/attendance/components/my-time";
import { AutoRefresh } from "@/modules/attendance/components/auto-refresh";
import { CorrectionForm, CorrectionList, FileForOthersForm, PreferencesForm, RulesForm, SetupProfileForm } from "@/modules/attendance/components/attendance-forms";
import { BulkCorrectionsPanel } from "@/modules/attendance/components/bulk-corrections-panel";
import { FormDialog } from "@/components/form-dialog";
import { IssueList, ReportIssueForm } from "@/modules/attendance/components/issue-panels";
import { listIssueQueue, listMyIssues } from "@/modules/attendance/issue-queries";
import { HealthPanel } from "@/modules/health/components/health-panel";
import { getSystemHealth } from "@/modules/health/queries";
import { ExportPanel } from "@/modules/attendance/components/hours-panels";
import { getHoursSettings } from "@/modules/attendance/hours-queries";
import { getMyTime, listClockRules, listCorrectionBatches, listCorrectionQueue, listFilablePeople } from "@/modules/attendance/queries";

export const metadata: Metadata = { title: "Attendance" };

const ALL_TABS = [
  { key: "mine", label: "My time" },
  { key: "corrections", label: "Corrections" },
  { key: "issues", label: "Technical issues" },
  { key: "export", label: "Hours export" },
  { key: "rules", label: "Rules" },
  { key: "health", label: "Health" },
] as const;

// Old addresses (bookmarks, notifications sent before these became their own pages) go to the page that now holds the content.
const MOVED: Record<string, string> = { team: "/team-attendance", extra: "/extra-hours", review: "/hours-review", jibble: "/jibble" };

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const user = await requireUser();
  const params = await searchParams;
  const moved = typeof params.tab === "string" ? MOVED[params.tab] : undefined;
  if (moved) redirect(typeof params.rweek === "string" && params.tab === "review" ? `${moved}?rweek=${encodeURIComponent(params.rweek)}` : moved);
  const allowed = new Set<string>(["mine", "issues"]);
  const canHandleIssues = ["all", "team"].includes(String(scopeFor(user, "attendance.handle_issue")));
  const approve = scopeFor(user, "attendance.approve_correction");
  if (approve === "all" || approve === "team") allowed.add("corrections");
  if (scopeFor(user, "attendance.manage_rules")) allowed.add("rules");
  if (scopeFor(user, "hours.export")) allowed.add("export");
  if (scopeFor(user, "health.view")) allowed.add("health");
  const tabs = ALL_TABS.filter((t) => allowed.has(t.key));
  const tab = tabs.find((t) => t.key === params.tab)?.key ?? "mine";

  const mine = tab === "mine" ? await orNotFound(getMyTime(typeof params.week === "string" ? params.week : undefined)) : null;
  // The person's own reports: read once, for the list on the Technical issues tab and the zone the report form shows times in.
  const myIssues = await orNotFound(listMyIssues());
  const issueQueue = tab === "issues" && canHandleIssues ? await orNotFound(listIssueQueue()) : null;
  const queue = tab === "corrections" ? await orNotFound(listCorrectionQueue()) : null;
  const filable = tab === "corrections" && ["all", "team"].includes(String(scopeFor(user, "attendance.file_for_others"))) ? await orNotFound(listFilablePeople()) : null;
  const hoursSettings = tab === "export" ? await orNotFound(getHoursSettings()) : null;
  const health = tab === "health" ? await orNotFound(getSystemHealth()) : null;
  const batches = tab === "corrections" && approve === "all" ? await orNotFound(listCorrectionBatches()) : null;
  const rules = tab === "rules" ? await orNotFound(listClockRules()) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Attendance"
        description="The time clock is in the header. ELEVATE is the only source of your hours."
        actions={
          mine ? (
            <>
              <FormDialog label="Ask for a correction" title="Ask for a time correction" variant="outline" size="lg">
                <CorrectionForm zone={mine.zone} />
              </FormDialog>
              <FormDialog label="Clock settings" title="Your clock settings" variant="outline">
                <PreferencesForm shareLocation={mine.prefs.shareLocation} timeZone={mine.prefs.timeZone} monitoringPublished={mine.monitoringPublished} />
              </FormDialog>
            </>
          ) : (
            <FormDialog label="Report a technical issue" title="Report a technical issue" description="The clock or Jibble not working, an outage, a failed device. Your lead and HR are told." variant="outline">
              <ReportIssueForm zone={myIssues?.zone ?? "America/Phoenix"} />
            </FormDialog>
          )
        }
      />

      <TabNav label="Attendance sections" items={tabs.map((t) => ({ key: t.key, label: t.label, href: `/attendance?tab=${t.key}` }))} current={tab} />

      {tab === "issues" ? (
        <div className="space-y-6">
          <section aria-label="My technical issue reports" className="space-y-3">
            <h2 className="text-lg font-semibold">My reports</h2>
            {myIssues ? <IssueList items={myIssues.items} zone={myIssues.zone} mode="mine" empty="You have not reported any technical issues." /> : <p className="text-sm text-muted-foreground">You do not have a people record yet. Ask HR.</p>}
          </section>
          {issueQueue ? (
            <section aria-label="Technical issue reports to handle" className="space-y-3">
              <h2 className="text-lg font-semibold">{issueQueue.scope === "team" ? "Your team's reports" : "All reports"}</h2>
              <IssueList items={issueQueue.items} zone="America/Phoenix" mode="queue" empty="No technical issues are waiting." />
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "mine" ? (
        mine ? (
          <div className="space-y-6">
            {mine.days.some((d) => d.open) ? <AutoRefresh seconds={30} /> : null}
            <MyTimeOverview mine={mine} />

            <div className="grid items-start gap-6 lg:grid-cols-2">
              <section aria-label="My corrections" className="space-y-3">
                <h2 className="text-lg font-semibold">My corrections</h2>
                <CorrectionList items={mine.corrections} zone={mine.zone} mode="mine" empty="You have not asked for any corrections." />
              </section>

              <section aria-label="My technical issue reports" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">My technical issue reports</h2>
                  <FormDialog label="Report a technical issue" title="Report a technical issue" description="The clock or Jibble not working, an outage, a failed device. A screenshot is required. Your lead and HR are told." variant="outline">
                    <ReportIssueForm zone={mine.zone} />
                  </FormDialog>
                </div>
                {myIssues ? <IssueList items={myIssues.items.slice(0, 5)} zone={myIssues.zone} mode="mine" empty="You have not reported any technical issues." /> : null}
                {myIssues && myIssues.items.length > 5 ? (
                  <p className="text-sm">
                    <Link href="/attendance?tab=issues" className="text-primary underline-offset-4 hover:underline">
                      All my reports
                    </Link>
                  </p>
                ) : null}
              </section>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-muted-foreground">Your account is not linked to a people record yet, and the time clock needs one.</p>
            {can(user, "people.create") ? <SetupProfileForm records={await orNotFound(listRecordsToClaim())} /> : <p className="text-sm">Ask HR to add you in People with your sign-in email, and the clock will appear.</p>}
          </div>
        )
      ) : null}

      {queue ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{queue.scope === "team" ? "Corrections from people on your team." : "Every pending correction. HR decides when nobody above the person can."}</p>
          {filable ? <FileForOthersForm people={filable} zone="America/Phoenix" /> : null}
          {batches ? <BulkCorrectionsPanel batches={batches} /> : null}
          <CorrectionList items={queue.items} zone="America/Phoenix" mode="queue" empty="No corrections are waiting." />
        </div>
      ) : null}

      {hoursSettings ? <ExportPanel settings={hoursSettings} /> : null}

      {health ? <HealthPanel health={health} /> : null}

      {rules ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Rules apply per team. A team with no rules has no IP restriction and the default idle prompt. Selfies and location need the monitoring policy to be published{rules.monitoringPublished ? " (it is)" : " (it is not yet)"}.
          </p>
          {rules.rows.length === 0 ? <p className="text-muted-foreground">There are no teams yet.</p> : null}
          {rules.rows.map((r) => (
            <RulesForm key={r.teamId} row={r} monitoringPublished={rules.monitoringPublished} />
          ))}
        </div>
      ) : null}
    </PageContainer>
  );
}
