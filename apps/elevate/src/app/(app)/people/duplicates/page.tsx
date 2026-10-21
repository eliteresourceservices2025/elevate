import type { Metadata } from "next";
import { orNotFound } from "@/lib/or-not-found";
import { DuplicatesPanel } from "@/modules/people/components/duplicates-panel";
import { getDuplicateReport } from "@/modules/people/duplicates-queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Duplicate people" };

export default async function DuplicatesPage() {
  const report = await orNotFound(getDuplicateReport());
  return (
    <PageContainer width="medium">
      <PageHeader
        title="Duplicate people"
        description="A person who changed their name or work email can end up in the directory and the org chart twice. Choose the record that stays: the other is archived, and the sign-in account follows the person."
        breadcrumbs={[{ label: "People", href: "/people" }, { label: "Duplicate people" }]}
      />
      <DuplicatesPanel report={report} />
    </PageContainer>
  );
}
