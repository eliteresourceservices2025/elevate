import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { NewEnvelopeForm } from "@/modules/signing/components/envelope-forms";
import { SendInstructions } from "@/modules/signing/components/send-instructions";
import { listSignerChoices, listSigneeGroups, listTemplates } from "@/modules/signing/queries";

export const metadata: Metadata = { title: "Send a document" };

export default async function NewEnvelopePage({ searchParams }: PageProps<"/signing/new">) {
  await requireUser();
  const sp = await searchParams;
  const [people, templates, groups] = await Promise.all([orNotFound(listSignerChoices()), orNotFound(listTemplates()), orNotFound(listSigneeGroups())]);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/signing" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Signing
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Send a document</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">Each person signs while signed in to ELEVATE with their authenticator code. When the last person signs, ELEVATE seals the document and adds a certificate.</p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <NewEnvelopeForm people={people} templates={templates} groups={groups} initialTemplateId={typeof sp.template === "string" ? sp.template : undefined} />
        <SendInstructions />
      </div>
    </div>
  );
}
