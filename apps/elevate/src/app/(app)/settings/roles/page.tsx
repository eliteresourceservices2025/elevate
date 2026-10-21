import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { RolesTable } from "@/modules/settings/components/roles-table";
import { listPeopleWithRoles } from "@/modules/settings/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Roles and access" };

export default async function RolesPage() {
  const user = await requireUser();
  const people = await orNotFound(listPeopleWithRoles()); // authorize("settings.manage_roles") inside

  return (
    <PageContainer>
      <PageHeader
        title="Roles and access"
        description="Changing roles signs the person out so the change applies right away. Every change is written to the audit log."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Roles and access" }]}
      />
      <RolesTable people={people} currentUserId={user.id} />
    </PageContainer>
  );
}
