import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { listOrgOptions } from "@/modules/org/queries";
import { EmployeeForm } from "@/modules/people/components/employee-form";
import { displayName } from "@/modules/people/format";
import { getProfile } from "@/modules/people/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Edit person" };

export default async function EditPersonPage({ params }: PageProps<"/people/[id]/edit">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requireUser();
  await orNotFound(authorize(user, "people.edit_profile"));
  const { employee: e } = await orNotFound(getProfile(id));
  const options = await orNotFound(listOrgOptions());

  return (
    <PageContainer width="form">
      <PageHeader
        title={<>Edit {displayName(e)}</>}
        description={
          <>
            <p className="mt-1 text-muted-foreground">
              Changes are written to the history and the audit log. IDs and bank details are edited on their own tabs.
            </p>
          </>
        }
        breadcrumbs={[{ label: `${displayName(e)}`, href: `/people/${id}` }, { label: `Edit ${displayName(e)}` }]}
      />
      <EmployeeForm
        mode="edit"
        employeeId={id}
        options={options}
        defaults={{
          legalFirstName: e.legalFirstName,
          legalMiddleName: e.legalMiddleName ?? "",
          legalLastName: e.legalLastName,
          preferredName: e.preferredName ?? "",
          birthDate: e.birthDate ?? "",
          civilStatus: (e.civilStatus ?? "") as never,
          workEmail: e.workEmail,
          personalEmail: e.personalEmail ?? "",
          mobile: e.mobile ?? "",
          addressLine: e.addressLine ?? "",
          city: e.city ?? "",
          province: e.province ?? "",
          postalCode: e.postalCode ?? "",
          country: e.country,
          positionId: e.positionId ?? "",
          status: e.status,
          workerType: e.workerType as never,
          startDate: e.startDate ?? "",
          endDate: e.endDate ?? "",
        }}
      />
    </PageContainer>
  );
}
