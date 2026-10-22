import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { NewEnvelopeForm } from "@/modules/signing/components/envelope-forms";
import { SendInstructions } from "@/modules/signing/components/send-instructions";
import { listSignerChoices, listSigneeGroups, listTemplates } from "@/modules/signing/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Send a document" };

export default async function NewEnvelopePage({ searchParams }: PageProps<"/signing/new">) {
  await requireUser();
  const sp = await searchParams;
  const [people, templates, groups] = await Promise.all([orNotFound(listSignerChoices()), orNotFound(listTemplates()), orNotFound(listSigneeGroups())]);
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Send a document"
        description="Each person signs while signed in to ELEVATE with their authenticator code. When the last person signs, ELEVATE seals the document and adds a certificate."
        breadcrumbs={[{ label: "Signing", href: "/signing" }, { label: "Send a document" }]}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <NewEnvelopeForm people={people} templates={templates} groups={groups} initialTemplateId={typeof sp.template === "string" ? sp.template : undefined} />
        <SendInstructions />
      </div>
    </PageContainer>
  );
}
