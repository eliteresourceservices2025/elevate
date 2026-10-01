import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { OpeningForm } from "@/modules/recruiting/components/opening-forms";
import { getOpeningFormOptions } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "New job" };

export default async function NewOpeningPage() {
  await requireUser();
  const options = await orNotFound(getOpeningFormOptions());
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/recruiting" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Recruiting
        </Link>
        <h1 className="mt-2 text-2xl font-bold">New job</h1>
        <p className="mt-1 text-muted-foreground">It starts as a draft. Publish it from its page when it is ready for the careers page.</p>
      </div>
      <OpeningForm teams={options.teams} people={options.people} />
    </div>
  );
}
