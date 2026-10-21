import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { IncidentThread, StatusBadge } from "@/modules/incidents/components/incident-panels";
import { kindLabel } from "@/modules/incidents/constants";
import { getIncident } from "@/modules/incidents/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Privacy incident" };

const Field = ({ label, value }: { label: string; value: string | null }) =>
  value ? (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm">{value}</dd>
    </div>
  ) : null;

export default async function IncidentPage({ params }: PageProps<"/incidents/[id]">) {
  const { id } = await params;
  const incident = await orNotFound(getIncident(id));
  if (!incident) notFound();

  return (
    <PageContainer width="form">
      <p className="text-sm">
        <Link href="/incidents" className="text-primary underline-offset-4 hover:underline">
          Back to privacy incidents
        </Link>
      </p>
      <PageHeader
        title={incident.reference}
        description={
          <>
            {kindLabel(incident.kind)}
            <StatusBadge status={incident.status} ongoing={incident.ongoing && incident.status !== "closed"} />
          </>
        }
      />
      <dl className="space-y-4 rounded-xl border bg-card p-4">
        <Field label="Filed by" value={incident.from} />
        <Field label="Client" value={incident.client} />
        <Field label="Day it happened" value={incident.happenedOn} />
        <Field label="What happened" value={incident.whatHappened} />
        <Field label="How it was found" value={incident.howFound} />
        <Field label="Who else knows" value={incident.whoElseKnows} />
        <Field label="Already done" value={incident.actionsTaken} />
      </dl>
      <IncidentThread incident={incident} canHandleThis={incident.isHandler && !incident.isOwner} />
    </PageContainer>
  );
}
