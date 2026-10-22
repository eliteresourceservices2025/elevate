import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { orNotFound } from "@/lib/or-not-found";
import { TemplateEditor } from "@/modules/recruiting/components/template-editor";
import { listEmailTemplates } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "Applicant emails" };

export default async function EmailTemplatesPage() {
  const templates = await orNotFound(listEmailTemplates());
  return (
    <PageContainer width="medium">
      <PageHeader
        title="Applicant emails"
        description="The wording of the emails applicants get. Interview invitations are written for each interview and are not changed here."
        breadcrumbs={[{ label: "Recruiting", href: "/recruiting" }, { label: "Applicant emails" }]}
      />
      <div className="space-y-4">
        {templates.map((t) => (
          <TemplateEditor key={t.kind} template={t} />
        ))}
      </div>
    </PageContainer>
  );
}
