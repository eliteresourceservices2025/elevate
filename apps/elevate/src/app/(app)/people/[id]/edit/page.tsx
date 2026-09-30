import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { EmployeeForm } from "@/modules/people/components/employee-form";
import { displayName } from "@/modules/people/format";
import { getProfile } from "@/modules/people/queries";

export const metadata: Metadata = { title: "Edit person" };

export default async function EditPersonPage({ params }: PageProps<"/people/[id]/edit">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requireUser();
  await orNotFound(authorize(user, "people.edit_profile"));
  const { employee: e } = await orNotFound(getProfile(id));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/people/${id}`} className="text-sm text-primary underline-offset-4 hover:underline">
          ← {displayName(e)}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Edit {displayName(e)}</h1>
        <p className="mt-1 text-muted-foreground">Changes are written to the history and the audit log. IDs and bank details are edited on their own tabs.</p>
      </div>
      <EmployeeForm
        mode="edit"
        employeeId={id}
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
          position: e.position ?? "",
          status: e.status,
          workerType: e.workerType as never,
          startDate: e.startDate ?? "",
          endDate: e.endDate ?? "",
        }}
      />
    </div>
  );
}
