import type { Metadata } from "next";
import Link from "next/link";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { CaseTable, MyTasks } from "@/modules/onboarding/components/case-table";
import { listMyTasks, listOffboardingCases } from "@/modules/onboarding/queries";

export const metadata: Metadata = { title: "Offboarding" };

export default async function OffboardingPage({ searchParams }: PageProps<"/offboarding">) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const [cases, tasks] = await Promise.all([orNotFound(listOffboardingCases()), listMyTasks()]);
  const hr = scopeFor(user, "offboarding.manage") === "all";

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Offboarding</h1>
          <p className="mt-1 text-muted-foreground">Handover, equipment, final hours and removing access when someone leaves.</p>
        </div>
        {hr ? (
          <div className="flex gap-3 text-sm">
            <Link href="/offboarding/new" className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground">
              Start an offboarding
            </Link>
            <Link href="/onboarding/templates" className="self-center text-primary underline-offset-2 hover:underline">
              Checklist templates
            </Link>
          </div>
        ) : null}
      </div>
      <MyTasks tasks={tasks.filter((t) => t.kind === "offboarding")} />
      <section aria-label="Cases" className="space-y-2">
        <h2 className="text-lg font-semibold">Offboarding cases</h2>
        <CaseTable rows={cases} kind="offboarding" page={paging.page} pageSize={paging.pageSize} basePath="/offboarding" />
      </section>
    </div>
  );
}
