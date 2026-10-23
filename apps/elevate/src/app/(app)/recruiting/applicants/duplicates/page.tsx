import type { Metadata } from "next";
import { Copy } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { orNotFound } from "@/lib/or-not-found";
import { MergeGroup } from "@/modules/recruiting/components/merge-form";
import { listDuplicateGroups } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "Possible duplicate applicants" };

export default async function DuplicatesPage() {
  const groups = await orNotFound(listDuplicateGroups());
  return (
    <PageContainer>
      <PageHeader
        title="Possible duplicate applicants"
        description="Records with the same phone number or the same name but different emails. You decide: merging moves everything to the record you keep."
        breadcrumbs={[{ label: "Applicants", href: "/recruiting/applicants" }, { label: "Possible duplicates" }]}
      />
      {groups.length === 0 ? (
        <EmptyState icon={Copy} title="No possible duplicates" description="No two applicants share a phone number or a name." />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <MergeGroup key={g.candidates.map((c) => c.id).join("-")} group={g} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
