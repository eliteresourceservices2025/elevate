import type { Metadata } from "next";
import { orNotFound } from "@/lib/or-not-found";
import { EarlySettings, ReviewTemplateEditor } from "@/modules/reviews/components/template-forms";
import { getReviewTemplates } from "@/modules/reviews/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Review templates" };

export default async function ReviewTemplatesPage() {
  const data = await orNotFound(getReviewTemplates());
  return (
    <PageContainer>
      <PageHeader
        title="Review templates"
        description="A cycle keeps its own copy of the questions, so changing a template never changes a cycle that is already running."
        breadcrumbs={[{ label: "All reviews", href: "/reviews" }, { label: "Review templates" }]}
      />
      <EarlySettings enabled={data.early.enabled} templateId={data.early.templateId} templates={data.templates.map((t) => ({ id: t.id, name: t.name }))} />
      {data.templates.map((t) => (
        <details key={t.id} className="rounded-xl border">
          <summary className="cursor-pointer p-3 font-medium">
            {t.name} <span className="font-normal text-muted-foreground">({t.questions.length} questions)</span>
          </summary>
          <div className="p-3 pt-0">
            <ReviewTemplateEditor template={t} />
          </div>
        </details>
      ))}
      <details className="rounded-xl border" open={data.templates.length === 0}>
        <summary className="cursor-pointer p-3 font-medium">Add a template</summary>
        <div className="p-3 pt-0">
          <ReviewTemplateEditor />
        </div>
      </details>
    </PageContainer>
  );
}
