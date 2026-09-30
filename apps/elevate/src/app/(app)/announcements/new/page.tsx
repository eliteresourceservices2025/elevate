import type { Metadata } from "next";
import { orNotFound } from "@/lib/or-not-found";
import { AnnouncementForm } from "@/modules/announcements/components/announcement-form";
import { getComposeOptions } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "New announcement" };

export default async function NewAnnouncementPage() {
  const options = await orNotFound(getComposeOptions());
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New announcement</h1>
        <p className="mt-1 text-muted-foreground">Posting notifies everyone it is addressed to. Do not include client or patient information.</p>
      </div>
      <AnnouncementForm today={todayInZone()} teams={options.teams} documents={options.documents} />
    </div>
  );
}
