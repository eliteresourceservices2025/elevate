import type { Metadata } from "next";
import Link from "next/link";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { PeopleRetentionForm } from "@/modules/people/components/retention-form";
import { getPeopleRetentionSettings, peopleRetentionCounts } from "@/modules/people/retention";

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
    <div className="w-full space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-primary underline-offset-2 hover:underline">
          Settings
        </Link>
        <h1 className="mt-1 text-2xl font-bold">People records retention</h1>
        <p className="mt-1 text-muted-foreground">
          After a person&apos;s engagement ends, their record is kept in full, then moved to an archive only HR can open, then anonymized. The job is off until you switch it on, and the periods need counsel&apos;s approval first. Put a legal hold on a person&apos;s profile to skip them.
        </p>
      </div>
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
    </div>
  );
}
