import type { Metadata } from "next";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { ExtraHoursPanel } from "@/modules/attendance/components/extra-hours-panel";
import { getMyExtraHours, listActiveClients, listExtraHoursQueue } from "@/modules/attendance/extra-hours-queries";
import { listFilablePeople } from "@/modules/attendance/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

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
    <PageContainer>
      <PageHeader
        title="Extra hours"
        description="Work beyond your schedule needs your client's OK and your lead's approval before it counts."
      />
      <ExtraHoursPanel mine={mine} queue={queue} filable={people} clients={clients} queueZone="America/Phoenix" />
    </PageContainer>
  );
}
