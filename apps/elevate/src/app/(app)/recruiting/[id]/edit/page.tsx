import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { OpeningForm } from "@/modules/recruiting/components/opening-forms";
import { getOpeningFormOptions } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "Edit job" };

export default async function EditOpeningPage({ params }: PageProps<"/recruiting/[id]/edit">) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const options = await orNotFound(getOpeningFormOptions(id));
  const o = options.opening;
  if (!o || o.archivedAt) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/recruiting/${id}`} className="text-sm text-primary underline-offset-4 hover:underline">
          ← {o.title}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Edit job</h1>
      </div>
      <OpeningForm
        teams={options.teams}
        people={options.people}
        initial={{ id: o.id, title: o.title, description: o.description, location: o.location, payNote: o.payNote ?? "", teamId: o.teamId ?? "", sendAck: o.sendAck, sendRejection: o.sendRejection, hiringTeamUserIds: options.hiringTeamUserIds }}
      />
    </div>
  );
}
