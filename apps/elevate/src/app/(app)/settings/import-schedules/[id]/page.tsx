import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { PlanView } from "@/modules/schedule-import/components/plan-view";
import { getScheduleImportPlan } from "@/modules/schedule-import/queries";

export const metadata: Metadata = { title: "Schedule import preview" };

export default async function ScheduleImportPreviewPage({ params }: PageProps<"/settings/import-schedules/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await orNotFound(getScheduleImportPlan(id));
  if (!data) notFound();
  const { batch, plan } = data;
  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/settings/import-schedules" className="text-sm text-primary underline-offset-2 hover:underline">
          Import schedules and clients
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Preview: {batch.fileName}</h1>
        <p className="mt-1 text-muted-foreground">
          {batch.observations} clocked-in days read, {plan.totals.pairs} people and clients on the sheet: {plan.totals.ready} matched, {plan.totals.needsDecision} need a person.
        </p>
      </div>
      <PlanView batchId={batch.id} plan={plan} />
    </div>
  );
}
