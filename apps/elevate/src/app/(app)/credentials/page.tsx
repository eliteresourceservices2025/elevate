import type { Metadata } from "next";
import Link from "next/link";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { PagerLinks } from "@/components/pager";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { AddCredentialForm, ImportCredentialsCard } from "@/modules/credentials/components/credential-forms";
import { CredentialTable } from "@/modules/credentials/components/credential-tables";
import { credentialCounts, getMyCredentials, listCredentialPeople, listCredentials, listTeamCredentials } from "@/modules/credentials/queries";
import { STATUSES, STATUS_LABELS } from "@/modules/credentials/rules";

export const metadata: Metadata = { title: "Certificates" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function CredentialsPage({ searchParams }: PageProps<"/credentials">) {
  const user = await requireUser();
  const scope = scopeFor(user, "credentials.view");
  const params = await searchParams;
  const hr = scope === "all";
  const lead = scope === "team";

  // Everyone with access sees their own; a lead also sees their team's; HR sees everyone's. Others: the query refuses and the page shows "not found".
  const mine = await orNotFound(getMyCredentials());
  const team = lead ? await orNotFound(listTeamCredentials()) : [];

  const filters = { status: one(params.status), q: one(params.q) };
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const list = hr ? await orNotFound(listCredentials(filters, paging)) : null;
  const counts = hr ? await orNotFound(credentialCounts()) : null;
  const canManage = scopeFor(user, "credentials.manage") === "all";
  const people = canManage ? await orNotFound(listCredentialPeople()) : [];

  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Certificates</h1>
        <p className="mt-1 text-muted-foreground">Training certificates that expire, such as HIPAA awareness. ELEVATE reminds the person and HR 30 days and 7 days before, and on the end date.</p>
      </div>

      <section aria-label="My certificates" className="space-y-2">
        <h2 className="text-lg font-semibold">My certificates</h2>
        <CredentialTable rows={mine} empty="No certificates are recorded for you." />
      </section>

      {lead ? (
        <section aria-label="Team certificates" className="space-y-2">
          <h2 className="text-lg font-semibold">My team&apos;s certificates</h2>
          <CredentialTable rows={team} showPerson empty="No certificates are recorded for your team." />
        </section>
      ) : null}

      {hr && list && counts ? (
        <section aria-label="All certificates" className="space-y-3">
          <h2 className="text-lg font-semibold">Everyone</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            <li>
              <Link href="/credentials?status=expired" className="rounded-full border px-3 py-1 hover:bg-secondary/50">
                Expired: {counts.expired}
              </Link>
            </li>
            <li>
              <Link href="/credentials?status=expiring" className="rounded-full border px-3 py-1 hover:bg-secondary/50">
                Expiring in 30 days: {counts.expiring}
              </Link>
            </li>
          </ul>
          <form method="get" action="/credentials" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3" aria-label="Filter the certificates">
            <div className="space-y-1">
              <Label htmlFor="f-q">Search</Label>
              <Input id="f-q" name="q" defaultValue={filters.q ?? ""} placeholder="Person or certificate" className="w-60" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-status">Status</Label>
              <NativeSelect id="f-status" name="status" defaultValue={filters.status ?? ""}>
                <option value="">Any</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {/* eslint-disable-next-line security/detect-object-injection -- s comes from the fixed STATUSES list */}
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              Filter
            </button>
            <Link href="/credentials" className="pb-1.5 text-sm text-primary underline-offset-2 hover:underline">
              Clear
            </Link>
          </form>
          <CredentialTable rows={list.rows} showPerson canRemove={canManage} empty="No certificates match." />
          <PagerLinks info={list.info} basePath="/credentials" query={{ status: filters.status, q: filters.q }} label="certificates" />
        </section>
      ) : null}

      {canManage ? (
        <>
          <AddCredentialForm people={people} />
          <ImportCredentialsCard />
        </>
      ) : null}
    </div>
  );
}
