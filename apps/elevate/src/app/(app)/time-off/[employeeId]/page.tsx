import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { AdjustForm, AwardForm } from "@/modules/timeoff/components/award-forms";
import { BalanceView } from "@/modules/timeoff/components/balance-view";
import { getAwardOptions, getPersonTimeOff } from "@/modules/timeoff/queries";
import { RequestList } from "@/modules/timeoff/components/request-list";
import { listRequestsFor } from "@/modules/timeoff/request-queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Prize days" };

export default async function PersonTimeOffPage({ params }: PageProps<"/time-off/[employeeId]">) {
  const { employeeId } = await params;
  const user = await requireUser();
  const data = await orNotFound(getPersonTimeOff(employeeId));
  if (!data) notFound();
  const requests = await orNotFound(listRequestsFor(employeeId));
  const options = can(user, "timeoff.award") ? await orNotFound(getAwardOptions()) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/time-off?tab=balances" className="text-sm text-primary underline-offset-4 hover:underline">
          All balances
        </Link>
        <h1 className="mt-2 text-2xl font-bold">
          {data.name} <span className="text-base font-normal text-muted-foreground">{data.employeeNumber}</span>
        </h1>
      </div>
      <BalanceView data={data} />
      <section aria-label="Requests" className="space-y-2">
        <h2 className="text-lg font-semibold">Requests</h2>
        <RequestList items={requests} empty="No requests yet." />
      </section>
      {options && options.types.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <AwardForm people={options.people} types={options.types} today={todayInZone()} fixedEmployee={data.employeeId} />
          <AdjustForm people={options.people} types={options.types} fixedEmployee={data.employeeId} />
        </div>
      ) : null}
    </div>
  );
}
