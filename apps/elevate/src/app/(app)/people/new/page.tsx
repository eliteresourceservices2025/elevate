import type { Metadata } from "next";
import Link from "next/link";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { EmployeeForm } from "@/modules/people/components/employee-form";

export const metadata: Metadata = { title: "Add person" };

export default async function NewPersonPage() {
  const user = await requireUser();
  await orNotFound(authorize(user, "people.create"));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/people" className="text-sm text-primary underline-offset-4 hover:underline">
          ← People
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Add person</h1>
        <p className="mt-1 text-muted-foreground">
          Government IDs and bank details are added afterwards on the profile, where they are encrypted. When this person signs
          in with the email below, their account links to this record automatically.
        </p>
      </div>
      <EmployeeForm mode="create" />
    </div>
  );
}
