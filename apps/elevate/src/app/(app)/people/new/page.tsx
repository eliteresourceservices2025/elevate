import type { Metadata } from "next";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { listOrgOptions } from "@/modules/org/queries";
import { EmployeeForm } from "@/modules/people/components/employee-form";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Add person" };

export default async function NewPersonPage() {
  const user = await requireUser();
  await orNotFound(authorize(user, "people.create"));
  const options = await orNotFound(listOrgOptions());

  return (
    <PageContainer width="form">
      <PageHeader
        title="Add person"
        description="Government IDs and bank details are added afterwards on the profile, where they are encrypted. When this person signs in with the email below, their account links to this record automatically."
        breadcrumbs={[{ label: "People", href: "/people" }, { label: "Add person" }]}
      />
      <EmployeeForm mode="create" options={options} />
    </PageContainer>
  );
}
