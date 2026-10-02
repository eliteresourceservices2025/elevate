import type { Metadata } from "next";
import Link from "next/link";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { CaseTable, MyTasks } from "@/modules/onboarding/components/case-table";
import { listMyTasks, listOnboardingCases } from "@/modules/onboarding/queries";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const [cases, tasks] = await Promise.all([orNotFound(listOnboardingCases()), listMyTasks()]);
  const hr = scopeFor(user, "onboarding.manage_templates") === "all";
  const mineOnly = scopeFor(user, "onboarding.view") === "own";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Onboarding</h1>
          <p className="mt-1 text-muted-foreground">Checklists for new people: documents, policies, equipment and meeting the team.</p>
        </div>
        {hr ? (
          <Link href="/onboarding/templates" className="text-sm text-primary underline-offset-2 hover:underline">
            Checklist templates
          </Link>
        ) : null}
      </div>
      <MyTasks tasks={tasks.filter((t) => t.kind === "onboarding")} />
      <section aria-label="Cases" className="space-y-2">
        <h2 className="text-lg font-semibold">{mineOnly ? "Your onboarding" : "Onboarding in progress and finished"}</h2>
        <CaseTable rows={cases} kind="onboarding" page={paging.page} pageSize={paging.pageSize} basePath="/onboarding" />
      </section>
    </div>
  );
}
