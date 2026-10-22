import type { Metadata } from "next";
import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { FormDialog } from "@/components/form-dialog";
import { AddPrivacyOfficerForm, IncidentForm, IncidentList, PrivacyOfficerCard } from "@/modules/incidents/components/incident-panels";
import { listClientChoices, listIncidentInbox, listMyIncidents, listPrivacyOfficers } from "@/modules/incidents/queries";
import { STATUSES, type IncidentStatus } from "@/modules/incidents/constants";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Privacy incidents" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function IncidentsPage({ searchParams }: PageProps<"/incidents">) {
  const user = await requireUser();
  const params = await searchParams;
  const isHandler = can(user, "incidents.handle");
  const canDesignate = can(user, "incidents.designate");

  const raw = one(params.status);
  const status: IncidentStatus | "open" | undefined = raw === "open" ? "open" : (STATUSES as readonly string[]).includes(raw ?? "") ? (raw as IncidentStatus) : isHandler && !raw ? "open" : undefined;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });

  const [mine, clients, inbox, officers] = await Promise.all([
    orNotFound(listMyIncidents()),
    orNotFound(listClientChoices()),
    isHandler ? orNotFound(listIncidentInbox({ status: raw === "all" ? undefined : status, ...paging })) : Promise.resolve(null),
    canDesignate ? orNotFound(listPrivacyOfficers()) : Promise.resolve(null),
  ]);

  const tabs: { key: string; label: string }[] = [{ key: "open", label: "Open" }, { key: "new", label: "New" }, { key: "in_review", label: "In review" }, { key: "closed", label: "Closed" }, { key: "all", label: "All" }];
  const activeTab = raw ?? "open";

  return (
    <PageContainer width="medium">
      <PageHeader
        title="Privacy incidents"
        description="Sent something to the wrong person, lost a device, clicked a suspicious link, or seen information you should not have? Tell us as soon as you notice. It does not matter whether you are sure it is a problem, and nobody is punished for reporting in good faith."
        actions={
          <>
            <FormDialog label="Report an incident" title="Report an incident" size="lg">
              <IncidentForm clients={clients} />
            </FormDialog>
            {canDesignate ? (
              <FormDialog
                label="Add a Privacy Officer"
                title="Add a Privacy Officer"
                description="HR and Super Admin always see reports. A Privacy Officer is someone else you name who reads and handles them too."
                variant="outline"
              >
                <AddPrivacyOfficerForm />
              </FormDialog>
            ) : null}
          </>
        }
      />

      <section aria-label="Your reports" className="space-y-3">
        <h2 className="text-lg font-semibold">Your reports</h2>
        <IncidentList rows={mine} empty="You have not filed any reports." />
      </section>

      {inbox ? (
        <section aria-label="Inbox" className="space-y-3">
          <h2 className="text-lg font-semibold">Inbox ({inbox.openCount} open)</h2>
          <nav aria-label="Filter" className="flex flex-wrap gap-1.5 text-sm">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={t.key === "open" ? "/incidents" : `/incidents?status=${t.key}`}
                aria-current={activeTab === t.key ? "true" : undefined}
                className={cn("rounded-md border px-2.5 py-1", activeTab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-secondary/50")}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <IncidentList rows={inbox.rows} empty="Nothing here." />
          <PagerLinks info={inbox.info} basePath="/incidents" query={{ status: raw }} label="reports" />
        </section>
      ) : null}

      {officers ? <PrivacyOfficerCard officers={officers} /> : null}
    </PageContainer>
  );
}
