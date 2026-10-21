import type { Metadata } from "next";
import { orNotFound } from "@/lib/or-not-found";
import { DigestPreference } from "@/modules/notifications/components/digest-preference";
import { TrainingReminderPreference } from "@/modules/notifications/components/training-reminder-preference";
import { getMyDigestOptOut, getMyTrainingReminderOptOut } from "@/modules/notifications/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Email notifications" };

/** The signed-in person's own email choices. Everyone has this page; it only ever changes their own settings. */
export default async function NotificationSettingsPage() {
  const optedOut = await orNotFound(getMyDigestOptOut());
  const trainingOptedOut = await orNotFound(getMyTrainingReminderOptOut());

  return (
    <PageContainer width="form">
      <PageHeader
        title="Email notifications"
        description="Choose which emails ELEVATE sends you. Notifications inside ELEVATE (the bell) are not affected."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Email notifications" }]}
      />
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <DigestPreference optedOut={optedOut} />
        <TrainingReminderPreference optedOut={trainingOptedOut} />
      </div>
    </PageContainer>
  );
}
