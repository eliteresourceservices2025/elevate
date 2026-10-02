import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { TemplateEditor } from "@/modules/onboarding/components/template-editor";
import { getTemplates } from "@/modules/onboarding/queries";

export const metadata: Metadata = { title: "Checklist templates" };

export default async function ChecklistTemplatesPage() {
  const data = await orNotFound(getTemplates());
  const options = { positions: data.positions, documentTypes: data.documentTypes, signTemplates: data.signTemplates, policies: data.policies };
  const kinds = [
    { kind: "onboarding" as const, title: "Onboarding templates" },
    { kind: "offboarding" as const, title: "Offboarding templates" },
  ];
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link href="/onboarding" className="text-sm text-primary underline-offset-2 hover:underline">
          Onboarding
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Checklist templates</h1>
        <p className="mt-1 text-muted-foreground">A template for a position is used for people in that position; otherwise the default template applies. With no template, ELEVATE&apos;s built-in list is used. Changes affect new cases only.</p>
      </div>
      {kinds.map(({ kind, title }) => (
        <section key={kind} aria-label={title} className="space-y-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          {data.templates
            .filter((t) => t.kind === kind)
            .map((t) => (
              <details key={t.id} className="rounded-xl border">
                <summary className="cursor-pointer p-3 font-medium">
                  {t.name} <span className="font-normal text-muted-foreground">({t.positionTitle ?? "default"}, {t.items.length} tasks)</span>
                </summary>
                <div className="p-3 pt-0">
                  <TemplateEditor template={t} kind={kind} options={options} />
                </div>
              </details>
            ))}
          <details className="rounded-xl border">
            <summary className="cursor-pointer p-3 font-medium">Add a {kind} template</summary>
            <div className="p-3 pt-0">
              <TemplateEditor kind={kind} options={options} />
            </div>
          </details>
        </section>
      ))}
    </div>
  );
}
