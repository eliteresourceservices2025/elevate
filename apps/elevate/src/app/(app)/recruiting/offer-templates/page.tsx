import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { TemplateEditor } from "@/modules/offers/components/template-editor";
import { listOfferTemplates } from "@/modules/offers/queries";

export const metadata: Metadata = { title: "Offer templates" };

export default async function OfferTemplatesPage() {
  await requireUser();
  const templates = await orNotFound(listOfferTemplates()); // authorize("offers.manage_templates") inside
  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/recruiting" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Recruiting
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Offer templates</h1>
        <p className="mt-1 text-muted-foreground">Letters recruiters fill in and send for signature. Counsel should review the wording before real use.</p>
      </div>
      <TemplateEditor templates={templates} />
    </div>
  );
}
