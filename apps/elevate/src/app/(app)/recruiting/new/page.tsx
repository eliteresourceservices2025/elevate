import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { OpeningForm } from "@/modules/recruiting/components/opening-forms";
import { getOpeningFormOptions } from "@/modules/recruiting/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "New job" };

export default async function NewOpeningPage() {
  await requireUser();
  const options = await orNotFound(getOpeningFormOptions());
  return (
    <PageContainer width="form">
      <PageHeader
        title="New job"
        description="It starts as a draft. Publish it from its page when it is ready for the careers page."
        breadcrumbs={[{ label: "Recruiting", href: "/recruiting" }, { label: "New job" }]}
      />
      <OpeningForm teams={options.teams} people={options.people} />
    </PageContainer>
  );
}
