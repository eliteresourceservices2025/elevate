import type { Metadata } from "next";
import Link from "next/link";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { FormDialog } from "@/components/form-dialog";
import { StartOnboardingForm } from "@/modules/onboarding/components/case-actions";
import { CaseTable, MyTasks } from "@/modules/onboarding/components/case-table";
import { listMyTasks, listOnboardingCandidates, listOnboardingCases } from "@/modules/onboarding/queries";
import { todayInZone } from "@/modules/org/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const [cases, tasks] = await Promise.all([orNotFound(listOnboardingCases()), listMyTasks()]);
  const hr = scopeFor(user, "onboarding.manage_templates") === "all";
  const mineOnly = scopeFor(user, "onboarding.view") === "own";
  const canStart = scopeFor(user, "onboarding.start") === "all";
  const candidates = canStart ? await orNotFound(listOnboardingCandidates()) : [];

  return (
    <PageContainer>
      <PageHeader
        title="Onboarding"
        description="Checklists for new people: documents, policies, equipment and meeting the team."
        actions={
          <>
            {hr ? (
              <Link href="/onboarding/templates" className="text-sm text-primary underline-offset-2 hover:underline">
                Checklist templates
              </Link>
            ) : null}
            {canStart ? (
              <FormDialog
                label="Start onboarding"
                title="Start onboarding"
                description="For people added under People (not hired through Recruiting), who have no checklist until you start one. Tick one or many."
                size="lg"
              >
                {candidates.length > 0 ? (
                  <StartOnboardingForm people={candidates} today={todayInZone()} />
                ) : (
                  <p className="text-sm text-muted-foreground">Everyone already has an onboarding checklist.</p>
                )}
              </FormDialog>
            ) : null}
          </>
        }
      />
      <MyTasks tasks={tasks.filter((t) => t.kind === "onboarding")} />
      <section aria-label="Cases" className="space-y-2">
        <h2 className="text-lg font-semibold">{mineOnly ? "Your onboarding" : "Onboarding in progress and finished"}</h2>
        <CaseTable rows={cases} kind="onboarding" page={paging.page} pageSize={paging.pageSize} basePath="/onboarding" />
      </section>
    </PageContainer>
  );
}
