import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { OpeningForm } from "@/modules/recruiting/components/opening-forms";
import { getOpeningFormOptions } from "@/modules/recruiting/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Edit job" };

export default async function EditOpeningPage({ params }: PageProps<"/recruiting/[id]/edit">) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const options = await orNotFound(getOpeningFormOptions(id));
  const o = options.opening;
  if (!o || o.archivedAt) notFound();
  return (
    <PageContainer width="form">
      <PageHeader title="Edit job" breadcrumbs={[{ label: `${o.title}`, href: `/recruiting/${id}` }, { label: "Edit job" }]} />
      <OpeningForm
        teams={options.teams}
        people={options.people}
        status={o.status as "draft" | "open" | "closed"}
        initial={{ id: o.id, title: o.title, slug: o.slug ?? "", description: o.description, location: o.location, payNote: o.payNote ?? "", teamId: o.teamId ?? "", sendAck: o.sendAck, sendRejection: o.sendRejection, hiringTeamUserIds: options.hiringTeamUserIds }}
      />
    </PageContainer>
  );
}
