import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { AnnouncementForm } from "@/modules/announcements/components/announcement-form";
import { getAnnouncementForEdit } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Edit announcement" };

export default async function EditAnnouncementPage({ params }: PageProps<"/announcements/[id]/edit">) {
  const { id } = await params;
  const data = await orNotFound(getAnnouncementForEdit(id));
  if (!data) notFound();
  const { announcement: a } = data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Edit announcement</h1>
      <AnnouncementForm
        today={todayInZone()}
        teams={[]}
        documents={data.documents}
        edit={{
          announcementId: a.id,
          title: a.title,
          body: a.body,
          pinned: a.pinned,
          requiresAck: a.requiresAck,
          dueOn: a.dueOn,
          attachmentDocumentId: a.attachmentDocumentId,
          audience: a.audience === "teams" ? "teams" : "all",
          textLocked: data.textLocked,
        }}
      />
    </div>
  );
}
