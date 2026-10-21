import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TabNav } from "@/components/tab-nav";
import { Breadcrumbs } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatDateOnly, formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { STATUS_BADGE, STATUS_LABELS } from "@/modules/people/constants";
import { ArchiveMenu, PendingRequests } from "@/modules/people/components/hr-panels";
import {
  ClientsSection,
  EmergencySection,
  EmploymentSection,
  HistorySection,
  IdsSection,
  PayoutSection,
  PersonalSection,
} from "@/modules/people/components/profile-sections";
import { EmployeeDocuments } from "@/modules/documents/components/employee-documents";
import { displayName } from "@/modules/people/format";
import { initialsOf } from "@/lib/initials";
import { ChangePhotoButton, ProfilePicture, RemovePhotoButton } from "@/modules/people/components/profile-picture";
import { listOrgOptions } from "@/modules/org/queries";
import { getProfile, listClientsForFilter } from "@/modules/people/queries";
import { SelfIdCard } from "@/modules/demographics/components/self-id-card";
import { getMySelfIdentification, getPronounsFor } from "@/modules/demographics/queries";

const TABS = [
  { key: "personal", label: "Personal" },
  { key: "employment", label: "Employment" },
  { key: "ids", label: "Government IDs", needs: "canViewSensitive" },
  { key: "payout", label: "Payout", needs: "canViewSensitive" },
  { key: "emergency", label: "Emergency" },
  { key: "clients", label: "Client assignments", needs: "canViewClients" },
  { key: "documents", label: "Documents", needs: "canViewDocuments" },
  { key: "history", label: "History", needs: "canViewHistory" },
] as const;

/**
 * One person's profile. Shared by /people/[id] (anyone with access) and /people/me (the signed-in person's own), so My profile keeps its own
 * address and menu highlight instead of bouncing to the People list.
 */
export async function ProfileView({ id, requestedTab, basePath, own }: { id: string; requestedTab: string | undefined; basePath: string; own: boolean }) {
  const profile = await orNotFound(getProfile(id));
  const { employee: e, access } = profile;

  const visible = TABS.filter((t) => !("needs" in t) || access[t.needs]);
  const active = visible.find((t) => t.key === requestedTab) ?? visible[0];

  const today = formatInZone(new Date(), DEFAULT_TIMEZONE, "yyyy-MM-dd");
  const orgOptions = active.key === "employment" && access.canManageReporting ? await listOrgOptions() : undefined;
  const pronouns = await getPronounsFor(e.id);
  const mine = (own || access.isSelf) && active.key === "personal" ? await getMySelfIdentification() : null;
  const clients = active.key === "clients" && access.canManageAssignments ? await listClientsForFilter() : [];

  // The key facts under the name: only what this person's view of the profile already allows. The client comes from the assignments, which
  // only people who may see the Client assignments tab get.
  const currentClients = access.canViewClients ? profile.assignments.filter((a) => !a.endDate).map((a) => a.clientName) : null;
  const facts: { label: string; value: string | null }[] = [
    { label: "Employee no.", value: e.employeeNumber },
    { label: "Team", value: e.teamName },
    { label: "Manager", value: e.managerName },
    ...(currentClients ? [{ label: "Client", value: currentClients.join(", ") || null }] : []),
    { label: "Started", value: e.startDate ? formatDateOnly(e.startDate) : null },
  ];

  return (
    <PageContainer>
      <div className="space-y-3">
        <Breadcrumbs items={own ? [{ label: "My profile" }] : [{ label: "People", href: "/people" }, { label: displayName(e) }]} />

        <section aria-label="Profile summary" className="overflow-clip rounded-2xl border bg-card shadow-sm animate-in fade-in-0 duration-300 motion-reduce:animate-none">
          <div className="flex flex-wrap items-start gap-x-5 gap-y-4 p-5 md:p-6">
            <div className="flex flex-col items-center gap-1.5">
              <ProfilePicture initials={initialsOf(displayName(e), e.workEmail)} photo={e.photo} />
              {own || access.isSelf ? <ChangePhotoButton hasPhoto={e.photo !== null} /> : null}
              {!own && !access.isSelf && e.photo && access.canEdit ? <RemovePhotoButton userId={e.photo.userId} /> : null}
            </div>
            <div className="min-w-[min(100%,14rem)] flex-1">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                {displayName(e)}
                {pronouns ? <span className="ml-2 text-base font-normal text-muted-foreground">({pronouns})</span> : null}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{e.position ?? "No position set"}</span>
                <Badge variant={STATUS_BADGE[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                {e.archived ? <Badge variant="outline">Archived</Badge> : null}
                {access.canEdit && !e.linked ? <Badge variant="info">Not signed in yet</Badge> : null}
              </p>
            </div>
            {access.canEdit ? (
              <div className="flex items-center gap-2 print:hidden">
                <Link href={`/people/${e.id}/edit`} className={cn(buttonVariants())}>
                  Edit profile
                </Link>
                {access.canArchive ? <ArchiveMenu employeeId={e.id} archived={e.archived} /> : null}
              </div>
            ) : null}
          </div>
          {/* Each cell draws its right and bottom hairline; the list is pulled out by 1px so the outer edge's lines are clipped away. */}
          <ul className="-mr-px -mb-px grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] border-t">
            {facts.map((f) => (
              <li key={f.label} className="border-r border-b px-5 py-3 md:px-6">
                <p className="text-xs text-muted-foreground">{f.label}</p>
                <p className="mt-0.5 text-sm font-semibold">{f.value ?? <span className="font-normal text-muted-foreground/70">Not set</span>}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <PendingRequests requests={profile.pendingRequests} canCancel={access.canRequestChange} />

      <TabNav label="Profile sections" items={visible.map((t) => ({ key: t.key, label: t.label, href: `${basePath}?tab=${t.key}` }))} current={active.key} />

      {active.key === "personal" ? <PersonalSection profile={profile} /> : null}
      {mine ? (
        <div>
          <SelfIdCard initial={mine} />
        </div>
      ) : null}
      {active.key === "employment" ? <EmploymentSection profile={profile} orgOptions={orgOptions} today={today} /> : null}
      {active.key === "ids" ? <IdsSection profile={profile} /> : null}
      {active.key === "payout" ? <PayoutSection profile={profile} /> : null}
      {active.key === "emergency" ? <EmergencySection profile={profile} /> : null}
      {active.key === "clients" ? <ClientsSection profile={profile} clients={clients} today={today} /> : null}
      {active.key === "documents" ? <EmployeeDocuments employeeId={e.id} canUpload={access.canUploadDocuments} /> : null}
      {active.key === "history" ? <HistorySection profile={profile} /> : null}
    </PageContainer>
  );
}
