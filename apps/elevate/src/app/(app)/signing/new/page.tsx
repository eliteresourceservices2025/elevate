import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { NewEnvelopeForm } from "@/modules/signing/components/envelope-forms";
import { listSignerChoices, listTemplates } from "@/modules/signing/queries";

export const metadata: Metadata = { title: "Send a document" };

export default async function NewEnvelopePage({ searchParams }: PageProps<"/signing/new">) {
  await requireUser();
  const sp = await searchParams;
  const [people, templates] = await Promise.all([orNotFound(listSignerChoices()), orNotFound(listTemplates())]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/signing" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Signing
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Send a document</h1>
        <p className="mt-1 text-muted-foreground">Each person signs while signed in to ELEVATE with their authenticator code. When the last person signs, ELEVATE seals the document and adds a certificate.</p>
      </div>
      <NewEnvelopeForm people={people} templates={templates} initialTemplateId={typeof sp.template === "string" ? sp.template : undefined} />
    </div>
  );
}
