import type { Metadata } from "next";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { PeopleRetentionForm } from "@/modules/people/components/retention-form";
import { getPeopleRetentionSettings, peopleRetentionCounts } from "@/modules/people/retention";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "People records retention" };

async function load() {
  const user = await requireUser();
  await authorize(user, "people.manage_retention");
  const [settings, counts] = await Promise.all([getPeopleRetentionSettings(), peopleRetentionCounts()]);
  return { settings, counts };
}

export default async function PeopleRetentionPage() {
  const { settings, counts } = await orNotFound(load());
  return (
    <PageContainer>
      <PageHeader
        title="People records retention"
        description="After a person's engagement ends, their record is kept in full, then moved to an archive only HR can open, then anonymized. The job is off until you switch it on, and the periods need counsel's approval first. Put a legal hold on a person's profile to skip them."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "People records retention" }]}
      />
      <PeopleRetentionForm initial={{ enabled: settings.enabled, archiveAfterMonths: settings.archiveAfterMonths, anonymizeAfterMonths: settings.anonymizeAfterMonths }} />
      <section aria-label="What would happen next" className="space-y-2">
        <h2 className="text-lg font-semibold">What would move at the next run</h2>
        <ul className="divide-y rounded-xl border bg-card text-sm">
          <li className="flex justify-between p-3"><span>To the HR-only archive</span><span className="font-medium">{counts.toArchive}</span></li>
          <li className="flex justify-between p-3"><span>To be anonymized</span><span className="font-medium">{counts.toAnonymize}</span></li>
          <li className="flex justify-between p-3"><span>On legal hold (skipped)</span><span className="font-medium">{counts.onHold}</span></li>
        </ul>
        <p className="text-xs text-muted-foreground">Counts only. {counts.enabled ? "The job is on." : "The job is off, so nothing moves."}</p>
      </section>
    </PageContainer>
  );
}
