import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { CallSettingsPanel } from "@/modules/calls/components/call-settings-panel";
import { getCallSettingsView } from "@/modules/calls/settings";

export const metadata: Metadata = { title: "Calls" };

// Super Admins only: anyone else gets a 404 (the query checks calls.settings). No loading.tsx: this route can call notFound().
export default async function CallsSettingsPage() {
  const view = await orNotFound(getCallSettingsView());
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Calls"
        description="How much call media you are using against the free allowance, and the call switches. No call content is ever shown here."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Calls" }]}
      />
      <CallSettingsPanel view={view} timeZone={DEFAULT_TIMEZONE} />
    </PageContainer>
  );
}
