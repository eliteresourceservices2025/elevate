import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { FormDialog } from "@/components/form-dialog";
import { DataRightsForm, DownloadButtons } from "@/modules/privacy/components/my-data-controls";
import { getMyData } from "@/modules/privacy/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "My data" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
const when = (iso: string) => formatInZone(new Date(iso), DEFAULT_TIMEZONE, "MMM d, yyyy");

export default async function MyDataPage() {
  const { data, noticePolicyId, openRequest } = await orNotFound(getMyData());
  const p = data.profile;
  const rows: [string, string | null][] = p
    ? [
        ["Employee number", p.employeeNumber],
        ["Legal name", [p.legalFirstName, p.legalMiddleName, p.legalLastName].filter(Boolean).join(" ")],
        ["Preferred name", p.preferredName],
        ["Birth date", p.birthDate],
        ["Civil status", p.civilStatus],
        ["Work email", p.workEmail],
        ["Personal email", p.personalEmail],
        ["Mobile", p.mobile],
        ["Address", p.address],
        ["Status", p.status],
        ["Worker type", p.workerType],
        ["Position", p.position],
        ["Team", p.team],
        ["Manager", p.manager],
        ["Start date", p.startDate],
        ["End date", p.endDate],
      ]
    : [];

  return (
    <PageContainer width="form">
      <PageHeader
        title="My data"
        description={
          <>
            What ELEVATE holds about you. Only you see this page.
            {noticePolicyId ? (
              <>
                {" "}
                Read the{" "}
                <Link href={`/announcements/policies/${noticePolicyId}`} className="text-primary underline underline-offset-4">
                  privacy notice
                </Link>
                .
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <FormDialog
              label="Ask HR about your data"
              title="Ask HR about your data"
              description="You can ask HR to correct your data or to delete it. HR reviews every request. Some records must be kept by law, so nothing is deleted automatically."
            >
              <DataRightsForm hasOpenRequest={openRequest} />
            </FormDialog>
          </>
        }
      />

      {openRequest ? <p className="text-sm text-muted-foreground">You have a request waiting for HR. You can send another once it is handled.</p> : null}

      <DownloadButtons />

      <Section title="Profile">
        {!p ? (
          <Empty>No people record is linked to your account yet.</Empty>
        ) : (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="inline text-muted-foreground">{k}: </dt>
                <dd className="inline">{v ?? "Not on file"}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Government IDs, bank and pay">
        <p className="text-xs text-muted-foreground">Shown masked. To see the full value, reveal it on your profile; each reveal is logged.</p>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {data.sensitive.map((s) => (
            <div key={s.field}>
              <dt className="inline text-muted-foreground">{s.label}: </dt>
              <dd className="inline font-mono">{s.masked ?? "Not on file"}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Emergency contacts">
        {data.emergencyContacts.length === 0 ? (
          <Empty>None on file.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.emergencyContacts.map((c, i) => (
              <li key={i}>
                {c.name} ({c.relationship}) · {c.phone} {c.primary ? <Badge variant="secondary">Primary</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Client assignments">
        {data.clients.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.clients.map((c, i) => (
              <li key={i}>
                {c.client}: {c.startDate} to {c.endDate ?? "present"}
                {c.hoursPerWeek ? `, ${c.hoursPerWeek} hours a week` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Documents on file">
        {data.documents.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.documents.map((d, i) => (
              <li key={i}>
                {d.title}{" "}
                <span className="text-muted-foreground">
                  ({d.type}, {d.verified ? "verified" : "not yet verified"}
                  {d.expiresOn ? `, expires ${d.expiresOn}` : ""})
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Files are downloaded from the Documents tab on your profile.</p>
      </Section>

      <Section title="Employment history">
        {data.history.length === 0 ? (
          <Empty>No entries.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.history.map((h, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{h.date}</span> {h.summary}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Announcements and policies you acknowledged">
        {data.acknowledgments.length === 0 ? (
          <Empty>None yet.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.acknowledgments.map((a, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{when(a.at)}</span> {a.kind}: {a.title}
                {a.version ? ` (version ${a.version})` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Training (ELEVATE Learn)">
        <p className="text-xs text-muted-foreground">Dates, status, time spent and certificates. Your answers are not included.</p>
        {data.training.length === 0 ? (
          <Empty>None yet.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.training.map((t, i) => (
              <li key={i}>
                {t.course} (version {t.version}): {t.status}, assigned {t.assignedOn}, due {t.dueOn}
                {t.passedOn ? `, passed ${t.passedOn}` : ""}, about {t.minutesSpent} minutes
                {t.certificate ? `; certificate ${t.certificate}, valid until ${t.validUntil}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Activity on your record">
        <p className="text-xs text-muted-foreground">What you did, and what was done to your record. Other people are not named.</p>
        {data.activity.length === 0 ? (
          <Empty>No entries.</Empty>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {data.activity.map((a, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{when(a.at)}</span> {a.action} <span className="text-muted-foreground">by {a.by}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data.requests.length > 0 ? (
        <Section title="Your requests to HR">
          <ul className="space-y-1 text-sm">
            {data.requests.map((r, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{when(r.createdAt)}</span> {r.category}: <Badge variant="outline">{r.status}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </PageContainer>
  );
}
