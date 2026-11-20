import type { Metadata } from "next";
import { FormDialog } from "@/components/form-dialog";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { NewReleaseForm } from "@/modules/activity/components/release-forms";
import { ReleasesTable } from "@/modules/activity/components/releases-table";
import { getReleaseAdminView } from "@/modules/activity/release-queries";

export const metadata: Metadata = { title: "ELEVATE Tracker releases" };

// HR Admin and Super Admin only: anyone else gets a 404 (the query checks tracker.manage_releases). No loading.tsx: this route can call notFound().
export default async function TrackerReleasesPage() {
  const view = await orNotFound(getReleaseAdminView());
  return (
    <PageContainer width="wide">
      <PageHeader
        title="ELEVATE Tracker releases"
        description="Write what changed in each version of the app, then publish it. People see published releases on the ELEVATE Tracker App page."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "ELEVATE Tracker", href: "/settings/tracker" }, { label: "Releases" }]}
        actions={
          <FormDialog label="New release" title="New release" description="Create a draft. Add its builds with the release script, then publish.">
            <NewReleaseForm policyVersions={view.policyVersions} />
          </FormDialog>
        }
      />
      <section aria-label="How builds get here" className="rounded-xl border bg-card p-4 text-sm">
        <h2 className="font-semibold">Adding the app files</h2>
        <p className="mt-1 text-muted-foreground">
          HR does not upload app files. After the app is built and signed, the release script adds each file to the draft: <code className="font-mono">pnpm tracker:build</code> (see docs/modules/activity-tracker.md). A release needs an installer and an update file for every computer type it supports before it can be published.
        </p>
      </section>
      <ReleasesTable releases={view.releases} zone={DEFAULT_TIMEZONE} />
    </PageContainer>
  );
}
