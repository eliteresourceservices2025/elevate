import type { Metadata } from "next";
import Link from "next/link";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { FormDialog } from "@/components/form-dialog";
import { StartOffboardingForm } from "@/modules/onboarding/components/case-actions";
import { CaseTable, MyTasks } from "@/modules/onboarding/components/case-table";
import { listMyTasks, listOffboardingCandidates, listOffboardingCases } from "@/modules/onboarding/queries";
import { todayInZone } from "@/modules/org/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Offboarding" };

export default async function OffboardingPage({ searchParams }: PageProps<"/offboarding">) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const [cases, tasks] = await Promise.all([orNotFound(listOffboardingCases()), listMyTasks()]);
  const hr = scopeFor(user, "offboarding.manage") === "all";
  const candidates = hr ? await orNotFound(listOffboardingCandidates()) : [];

  return (
    <PageContainer>
      <PageHeader
        title="Offboarding"
        description="Handover, equipment, final hours and removing access when someone leaves."
        actions={
          <>
            {hr ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Link href="/onboarding/templates" className="text-primary underline-offset-2 hover:underline">
                  Checklist templates
                </Link>
                <FormDialog
                  label="Start an offboarding"
                  title="Start an offboarding"
                  description="Someone who still has active reports cannot be offboarded: reassign their reports first. Tick one or many."
                  size="lg"
                >
                  <StartOffboardingForm people={candidates} today={todayInZone()} />
                </FormDialog>
              </div>
            ) : null}
          </>
        }
      />
      <MyTasks tasks={tasks.filter((t) => t.kind === "offboarding")} />
      <section aria-label="Cases" className="space-y-2">
        <h2 className="text-lg font-semibold">Offboarding cases</h2>
        <CaseTable rows={cases} kind="offboarding" page={paging.page} pageSize={paging.pageSize} basePath="/offboarding" />
      </section>
    </PageContainer>
  );
}
