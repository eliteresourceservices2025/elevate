import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { DuplicatesPanel } from "@/modules/people/components/duplicates-panel";
import { getDuplicateReport } from "@/modules/people/duplicates-queries";

export const metadata: Metadata = { title: "Duplicate people" };

export default async function DuplicatesPage() {
  const report = await orNotFound(getDuplicateReport());
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/people" className="text-sm text-primary underline-offset-4 hover:underline">
          ← People
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Duplicate people</h1>
        <p className="mt-1 text-muted-foreground">
          A person who changed their name or work email can end up in the directory and the org chart twice. Choose the record that stays: the other is archived, and the sign-in account follows the person.
        </p>
      </div>
      <DuplicatesPanel report={report} />
    </div>
  );
}
