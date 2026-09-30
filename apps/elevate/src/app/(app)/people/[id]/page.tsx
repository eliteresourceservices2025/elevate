import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/modules/people/constants";
import { ArchiveButton, PendingRequests } from "@/modules/people/components/hr-panels";
import {
  ClientsSection,
  EmergencySection,
  EmploymentSection,
  HistorySection,
  IdsSection,
  PayoutSection,
  PersonalSection,
} from "@/modules/people/components/profile-sections";
import { displayName } from "@/modules/people/format";
import { getProfile, listClientsForFilter } from "@/modules/people/queries";

export const metadata: Metadata = { title: "Profile" };

const TABS = [
  { key: "personal", label: "Personal" },
  { key: "employment", label: "Employment" },
  { key: "ids", label: "Government IDs", needs: "canViewSensitive" },
  { key: "payout", label: "Payout", needs: "canViewSensitive" },
  { key: "emergency", label: "Emergency" },
  { key: "clients", label: "Client assignments", needs: "canViewClients" },
  { key: "history", label: "History", needs: "canViewHistory" },
] as const;

export default async function ProfilePage({ params, searchParams }: PageProps<"/people/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const profile = await orNotFound(getProfile(id));
  const { employee: e, access } = profile;

  const visible = TABS.filter((t) => !("needs" in t) || access[t.needs]);
  const requested = (await searchParams).tab;
  const active = visible.find((t) => t.key === requested) ?? visible[0];

  const today = formatInZone(new Date(), DEFAULT_TIMEZONE, "yyyy-MM-dd");
  const clients = active.key === "clients" && access.canManageAssignments ? await listClientsForFilter() : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/people" className="text-sm text-primary underline-offset-4 hover:underline">
          ← People
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{displayName(e)}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{e.employeeNumber}</span>
              <span aria-hidden>·</span>
              <span>{e.position ?? "No position set"}</span>
              <Badge variant={e.status === "active" ? "default" : "secondary"}>{STATUS_LABELS[e.status]}</Badge>
              {e.archived ? <Badge variant="outline">Archived</Badge> : null}
              {access.canEdit && !e.linked ? <Badge variant="outline">Not signed in yet</Badge> : null}
            </p>
          </div>
          {access.canEdit ? (
            <div className="flex gap-2">
              <Link href={`/people/${e.id}/edit`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Edit
              </Link>
              {access.canArchive ? <ArchiveButton employeeId={e.id} archived={e.archived} /> : null}
            </div>
          ) : null}
        </div>
      </div>

      <PendingRequests requests={profile.pendingRequests} canCancel={access.canRequestChange} />

      <nav aria-label="Profile sections" className="flex flex-wrap gap-1 border-b">
        {visible.map((t) => (
          <Link
            key={t.key}
            href={`/people/${e.id}?tab=${t.key}`}
            aria-current={t.key === active.key ? "page" : undefined}
            className={cn(
              "-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm",
              t.key === active.key ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {active.key === "personal" ? <PersonalSection profile={profile} /> : null}
      {active.key === "employment" ? <EmploymentSection profile={profile} /> : null}
      {active.key === "ids" ? <IdsSection profile={profile} /> : null}
      {active.key === "payout" ? <PayoutSection profile={profile} /> : null}
      {active.key === "emergency" ? <EmergencySection profile={profile} /> : null}
      {active.key === "clients" ? <ClientsSection profile={profile} clients={clients} today={today} /> : null}
      {active.key === "history" ? <HistorySection profile={profile} /> : null}
    </div>
  );
}
