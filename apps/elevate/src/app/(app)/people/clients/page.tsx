import type { Metadata } from "next";
import { FormDialog } from "@/components/form-dialog";
import { clientTimeZones } from "@/lib/client-time-zones";
import { orNotFound } from "@/lib/or-not-found";
import { NewClientForm } from "@/modules/people/components/admin-forms";
import { ClientsBoard } from "@/modules/people/components/clients-board";
import { listClientProjectPeopleForAdmin, listClientProjectsForAdmin, listClients } from "@/modules/people/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const [clients, projects, projectPeople] = await orNotFound(Promise.all([listClients(), listClientProjectsForAdmin(), listClientProjectPeopleForAdmin()]));
  const timeZones = clientTimeZones(Intl.supportedValuesOf("timeZone"), clients.map((client) => client.timeZone));

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Clients"
        description="The companies ERS people work for, and their projects. Only names and the time zone are stored here, never any patient or customer information. A person who works for two or more clients picks the client or project on the clock."
        breadcrumbs={[{ label: "People", href: "/people" }, { label: "Clients" }]}
        actions={
          <FormDialog label="Add client" title="Add a client" description="Names only. Never enter patient information.">
            <NewClientForm timeZones={timeZones} />
          </FormDialog>
        }
      />
      <ClientsBoard
        clients={clients.map((c) => ({ id: c.id, name: c.name, timeZone: c.timeZone, holidayCalendar: c.holidayCalendar === "PH" ? "PH" : "US", isActive: c.isActive, handlesPhi: c.handlesPhi, allowNoProject: c.allowNoProject }))}
        projects={projects.map((p) => ({ id: p.id, clientId: p.clientId, name: p.name }))}
        clientPeople={projectPeople.clientPeople}
        members={projectPeople.members}
        timeZones={timeZones}
      />
    </PageContainer>
  );
}
