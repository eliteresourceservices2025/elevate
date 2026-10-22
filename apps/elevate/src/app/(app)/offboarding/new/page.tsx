import type { Metadata } from "next";
import { orNotFound } from "@/lib/or-not-found";
import { StartOffboardingForm } from "@/modules/onboarding/components/case-actions";
import { listOffboardingCandidates } from "@/modules/onboarding/queries";
import { todayInZone } from "@/modules/org/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Start an offboarding" };

export default async function NewOffboardingPage() {
  const people = await orNotFound(listOffboardingCandidates());
  return (
    <PageContainer>
      <PageHeader
        title="Start an offboarding"
        description="Someone who still has active reports cannot be offboarded: reassign their reports first."
        breadcrumbs={[{ label: "Offboarding", href: "/offboarding" }, { label: "Start an offboarding" }]}
      />
      <div className="max-w-2xl rounded-xl border bg-card p-4">
        <StartOffboardingForm people={people} today={todayInZone()} />
      </div>
    </PageContainer>
  );
}
