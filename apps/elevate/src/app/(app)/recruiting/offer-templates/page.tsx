import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { TemplateEditor } from "@/modules/offers/components/template-editor";
import { listOfferTemplates } from "@/modules/offers/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Offer templates" };

export default async function OfferTemplatesPage() {
  await requireUser();
  const templates = await orNotFound(listOfferTemplates()); // authorize("offers.manage_templates") inside
  return (
    <PageContainer>
      <PageHeader
        title="Offer templates"
        description="Letters recruiters fill in and send for signature. Counsel should review the wording before real use."
        breadcrumbs={[{ label: "Recruiting", href: "/recruiting" }, { label: "Offer templates" }]}
      />
      <TemplateEditor templates={templates} />
    </PageContainer>
  );
}
