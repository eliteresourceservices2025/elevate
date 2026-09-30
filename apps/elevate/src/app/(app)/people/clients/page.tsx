import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { ClientRow, NewClientForm } from "@/modules/people/components/admin-forms";
import { listClients } from "@/modules/people/queries";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const clients = await orNotFound(listClients());

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/people" className="text-sm text-primary underline-offset-4 hover:underline">
          ← People
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Clients</h1>
        <p className="mt-1 text-muted-foreground">
          The companies ERS people work for. Only the name and time zone are stored here, and never any patient or customer
          information.
        </p>
      </div>
      <NewClientForm />
      <ul className="divide-y rounded-xl border bg-card px-4">
        {clients.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No clients yet.</li> : null}
        {clients.map((c) => (
          <li key={c.id} className="py-3">
            <ClientRow client={{ id: c.id, name: c.name, timeZone: c.timeZone, isActive: c.isActive }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
