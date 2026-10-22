import type { Metadata } from "next";
import { orNotFound } from "@/lib/or-not-found";
import { AnnouncementForm } from "@/modules/announcements/components/announcement-form";
import { getComposeOptions } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "New announcement" };

export default async function NewAnnouncementPage() {
  const options = await orNotFound(getComposeOptions());
  return (
    <PageContainer width="form">
      <PageHeader
        title="New announcement"
        description="Posting notifies everyone it is addressed to. Do not include client or patient information."
      />
      <AnnouncementForm today={todayInZone()} teams={options.teams} documents={options.documents} />
    </PageContainer>
  );
}
