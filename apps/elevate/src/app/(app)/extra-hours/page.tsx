import type { Metadata } from "next";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { ExtraHoursPanel } from "@/modules/attendance/components/extra-hours-panel";
import { getMyExtraHours, listActiveClients, listExtraHoursQueue } from "@/modules/attendance/extra-hours-queries";
import { listFilablePeople } from "@/modules/attendance/queries";

export const metadata: Metadata = { title: "Extra hours" };

export default async function ExtraHoursPage() {
  const user = await requireUser();
  const reviewScope = scopeFor(user, "extra_hours.decide");
  const canReview = reviewScope === "all" || reviewScope === "team";
  const fileScope = scopeFor(user, "extra_hours.file_for_others");
  const canFile = fileScope === "all" || fileScope === "team";
  const mine = await orNotFound(getMyExtraHours());
  const queue = canReview ? await orNotFound(listExtraHoursQueue()) : null;
  const people = canFile ? await orNotFound(listFilablePeople()) : null;
  const clients = canFile ? await orNotFound(listActiveClients()) : null;
  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Extra hours</h1>
        <p className="mt-1 text-muted-foreground">Work beyond your schedule needs your client&apos;s OK and your lead&apos;s approval before it counts.</p>
      </div>
      <ExtraHoursPanel mine={mine} queue={queue} filable={people} clients={clients} queueZone="America/Phoenix" />
    </div>
  );
}
