import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { formatDateOnly } from "@/lib/time";
import { CompleteOnboardingButton } from "@/modules/onboarding/components/case-actions";
import { TaskList } from "@/modules/onboarding/components/task-list";
import { getOnboardingCase } from "@/modules/onboarding/queries";
import { syncCase } from "@/modules/onboarding/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingCasePage({ params }: PageProps<"/onboarding/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await orNotFound(getOnboardingCase(id)); // access check before anything is recorded
  await syncCase("onboarding", id); // record what ELEVATE can already see is done, so the page is current
  const c = await orNotFound(getOnboardingCase(id));

  return (
    <PageContainer>
      <PageHeader
        title={<>Onboarding: {c.name}</>}
        description={
          <>
            <p className="text-muted-foreground">
              {c.position ? `${c.position}. ` : ""}Starts {formatDateOnly(c.date)}. {c.progress.done} of {c.progress.total} tasks done.
              {c.status !== "open" ? ` This onboarding is ${c.status}.` : ""}
            </p>
            {c.hiredWithoutOfferReason && c.canManage ? (
              <p className="mt-1 text-sm text-muted-foreground">Hired without a signed offer: {c.hiredWithoutOfferReason}</p>
            ) : null}
          </>
        }
        breadcrumbs={[{ label: "All onboarding", href: "/onboarding" }, { label: `Onboarding: ${c.name}` }]}
      />
      <TaskList tasks={c.tasks} canManage={c.canManage} open={c.status === "open"} />
      {c.canManage && c.status === "open" ? <CompleteOnboardingButton caseId={c.id} ready={c.progress.ready} openTasks={c.tasks.filter((t) => t.required && t.status === "todo").map((t) => t.title)} /> : null}
    </PageContainer>
  );
}
