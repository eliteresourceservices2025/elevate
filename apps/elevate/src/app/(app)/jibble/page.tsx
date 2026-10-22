import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { JibblePanel } from "@/modules/jibble/components/jibble-panel";
import { getJibbleOverview } from "@/modules/jibble/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Jibble" };

export default async function JibblePage() {
  await requireUser();
  const overview = await orNotFound(getJibbleOverview());
  return (
    <PageContainer>
      <PageHeader title="Jibble" description="Connection status, people matching and the latest calls." />
      <JibblePanel overview={overview} />
    </PageContainer>
  );
}
