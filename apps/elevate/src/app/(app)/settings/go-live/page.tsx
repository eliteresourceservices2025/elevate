import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { GoLiveList } from "@/modules/imports/components/go-live-list";
import { getGoLive } from "@/modules/imports/golive-queries";

export const metadata: Metadata = { title: "Go-live checklist" };

export default async function GoLivePage() {
  const { rows, notProduction } = await orNotFound(getGoLive());
  const done = rows.filter((r) => r.done).length;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-primary underline-offset-2 hover:underline">
          Settings
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Go-live checklist</h1>
        <p className="mt-1 text-muted-foreground">
          {done} of {rows.length} done. The first rows check themselves from this system; the rest are yours to tick off.
        </p>
        {notProduction ? <p className="mt-2 rounded-lg border border-brand-gold bg-brand-gold/10 p-3 text-sm">This is not the production deployment, so the automatic checks describe this copy. Open the checklist on the live site before cutover.</p> : null}
      </div>
      <GoLiveList rows={rows} />
    </div>
  );
}
