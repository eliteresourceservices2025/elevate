import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { LaunchCycleForm } from "@/modules/reviews/components/template-forms";
import { getLaunchOptions } from "@/modules/reviews/queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Launch a review cycle" };

export default async function NewCyclePage() {
  const o = await orNotFound(getLaunchOptions());
  return (
    <div className="w-full space-y-4">
      <div>
        <Link href="/reviews" className="text-sm text-primary underline-offset-2 hover:underline">
          All reviews
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Launch a review cycle</h1>
        <p className="mt-1 text-muted-foreground">Each person gets a review. Their lead is whoever they report to today.</p>
      </div>
      {o.templates.length === 0 ? (
        <p className="text-sm">
          Make a template first on the{" "}
          <Link href="/reviews/templates" className="text-primary underline-offset-2 hover:underline">
            templates page
          </Link>
          .
        </p>
      ) : (
        <LaunchCycleForm templates={o.templates} teams={o.teams} people={o.people} today={todayInZone()} />
      )}
    </div>
  );
}
