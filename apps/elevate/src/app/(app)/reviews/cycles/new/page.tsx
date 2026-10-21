import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { LaunchCycleForm } from "@/modules/reviews/components/template-forms";
import { getLaunchOptions } from "@/modules/reviews/queries";
import { todayInZone } from "@/modules/org/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Launch a review cycle" };

export default async function NewCyclePage() {
  const o = await orNotFound(getLaunchOptions());
  return (
    <PageContainer>
      <PageHeader
        title="Launch a review cycle"
        description="Each person gets a review. Their lead is whoever they report to today."
        breadcrumbs={[{ label: "All reviews", href: "/reviews" }, { label: "Launch a review cycle" }]}
      />
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
    </PageContainer>
  );
}
