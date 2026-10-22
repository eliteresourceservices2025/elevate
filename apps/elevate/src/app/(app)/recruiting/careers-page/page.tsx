import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { CareersPageEditor } from "@/modules/recruiting/components/careers-page-editor";
import { getCareersPageForEdit } from "@/modules/recruiting/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Careers page" };

export default async function CareersPageSettingsPage() {
  await requireUser();
  const page = await orNotFound(getCareersPageForEdit());
  return (
    <PageContainer width="medium">
      <PageHeader
        title="Careers page"
        description={
          <>
            The words and picture at the top of the public job list.{" "}
            <a href="/careers" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
              See the live page
            </a>{" "}
            (opens in a new tab).
          </>
        }
        breadcrumbs={[{ label: "Recruiting", href: "/recruiting" }, { label: "Careers page" }]}
      />
      <CareersPageEditor initial={{ title: page.title ?? "", intro: page.intro ?? "", bannerVersion: page.bannerVersion }} />
    </PageContainer>
  );
}
