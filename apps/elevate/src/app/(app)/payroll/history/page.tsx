import type { Metadata } from "next";
import Link from "next/link";
import { createLoader, parseAsInteger, parseAsString } from "nuqs/server";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { HISTORY_LABELS as H } from "@/modules/payroll/constants";
import { HistoryTable } from "@/modules/payroll/components/history-table";
import { PayrollTabs } from "@/modules/payroll/components/payroll-tabs";
import { getHistoryFilterOptions, getPayrollHistory } from "@/modules/payroll/history-queries";

export const metadata: Metadata = { title: "Payroll history" };

// The filters live in the address (?run=&person=&actor=&from=&to=&page=&size=), read with nuqs on the server.
const loadFilters = createLoader({
  run: parseAsString,
  person: parseAsString,
  actor: parseAsString,
  from: parseAsString,
  to: parseAsString,
  page: parseAsInteger,
  size: parseAsInteger,
});

export default async function PayrollHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const f = await loadFilters(await searchParams);
  const paging = parsePaging({ page: f.page, size: f.size });

  // authorize("payroll.view_history") inside: a person without a payroll level (a Super Admin too) gets a 404.
  const options = await orNotFound(getHistoryFilterOptions());
  const result = await orNotFound(
    getPayrollHistory({ runId: f.run ?? undefined, employeeId: f.person ?? undefined, actorId: f.actor ?? undefined, from: f.from ?? undefined, to: f.to ?? undefined, page: paging.page, pageSize: paging.pageSize }),
  );
  const info = pageInfo(result.total, result.page, result.pageSize);
  const query = { run: f.run ?? undefined, person: f.person ?? undefined, actor: f.actor ?? undefined, from: f.from ?? undefined, to: f.to ?? undefined };
  const filtered = Object.values(query).some(Boolean);

  return (
    <PageContainer width="full">
      <PageHeader title="Payroll" description={H.description} />
      <PayrollTabs current="history" />

      <form method="get" action="/payroll/history" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="run">{H.filterRun}</Label>
          <NativeSelect id="run" name="run" defaultValue={f.run ?? ""}>
            <option value="">{H.anyRun}</option>
            {options.runs.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="person">{H.filterPerson}</Label>
          <NativeSelect id="person" name="person" defaultValue={f.person ?? ""}>
            <option value="">{H.anyPerson}</option>
            {options.people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="actor">{H.filterActor}</Label>
          <NativeSelect id="actor" name="actor" defaultValue={f.actor ?? ""}>
            <option value="">{H.anyActor}</option>
            {options.actors.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="from">{H.filterFrom}</Label>
          <Input id="from" name="from" type="date" defaultValue={f.from ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">{H.filterTo}</Label>
          <Input id="to" name="to" type="date" defaultValue={f.to ?? ""} />
        </div>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-5">
          <Button type="submit" variant="outline">{H.apply}</Button>
          {filtered ? (
            <Link href="/payroll/history" className={buttonVariants({ variant: "ghost" })}>
              {H.clear}
            </Link>
          ) : null}
        </div>
      </form>

      {result.error ? <Alert variant="destructive" className="rounded-lg p-3 text-sm">{result.error}</Alert> : <HistoryTable rows={result.rows} />}
      <PagerLinks info={info} basePath="/payroll/history" query={query} label="changes" />
    </PageContainer>
  );
}
