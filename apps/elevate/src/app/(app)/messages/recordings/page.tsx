import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { RecordingList } from "@/modules/calls/components/recording-list";
import { listMyRecordings } from "@/modules/calls/recording";

export const metadata: Metadata = { title: "Call recordings" };

// Recordings of calls the signed-in person was in (never a guest's). No loading.tsx: keep the page simple and fast.
export default async function RecordingsPage() {
  const user = await requireUser();
  const items = await listMyRecordings(user);
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Call recordings"
        description="Recordings of calls you were in. Everyone in a recorded call agreed first, and recordings are deleted after 30 days."
        breadcrumbs={[{ label: "Messages", href: "/messages" }, { label: "Call recordings" }]}
      />
      <RecordingList items={items} timeZone={DEFAULT_TIMEZONE} />
    </PageContainer>
  );
}
