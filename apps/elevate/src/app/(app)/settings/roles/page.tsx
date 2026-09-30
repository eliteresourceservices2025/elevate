import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { RolesTable } from "@/modules/settings/components/roles-table";
import { listPeopleWithRoles } from "@/modules/settings/queries";

export const metadata: Metadata = { title: "Roles and access" };

export default async function RolesPage() {
  const user = await requireUser();
  const people = await orNotFound(listPeopleWithRoles()); // authorize("settings.manage_roles") inside

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Roles and access</h1>
        <p className="mt-1 text-muted-foreground">
          Changing roles signs the person out so the change applies right away. Every change is written to the audit
          log.
        </p>
      </div>
      <RolesTable people={people} currentUserId={user.id} />
    </div>
  );
}
