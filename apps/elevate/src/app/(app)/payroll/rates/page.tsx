import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { orNotFound } from "@/lib/or-not-found";
import { recentPeriods } from "@/modules/attendance/pay-periods";
import { payrollToday } from "@/modules/payroll/service";
import { PayrollTabs } from "@/modules/payroll/components/payroll-tabs";
import { RatesTable } from "@/modules/payroll/components/rates-table";
import { SortMenu } from "@/modules/payroll/components/sort-menu";
import type { SortLinks } from "@/modules/payroll/components/sort-head";
import { getRateOptions, getRates } from "@/modules/payroll/queries";
import { DEFAULT_SORT, headerState, nextSort, parseSort, SORT_LABELS, sortLines, type SortHeader, type SortValue } from "@/modules/payroll/sort";

export const metadata: Metadata = { title: "Payroll rates" };

// The ways to order the pay lines (the run sheet has more: total payable and change need a run).
const RATE_SORTS: SortValue[] = ["name_asc", "name_desc", "client_asc", "rate_desc", "rate_asc"];
const RATE_HEADERS: SortHeader[] = ["name", "client", "rate"];

export default async function PayrollRatesPage({ searchParams }: PageProps<"/payroll/rates">) {
  const user = await requireUser();
  const query = await searchParams;
  const asked = parseSort(typeof query.sort === "string" ? query.sort : undefined);
  const sort = RATE_SORTS.includes(asked) ? asked : DEFAULT_SORT;
  const showEnded = query.ended === "1";
  const hrefFor = (s: SortValue, ended: boolean) => {
    const params = new URLSearchParams();
    if (s !== DEFAULT_SORT) params.set("sort", s);
    if (ended) params.set("ended", "1");
    const text = params.toString();
    return text ? `/payroll/rates?${text}` : "/payroll/rates";
  };
  const hrefWith = (s: SortValue) => hrefFor(s, showEnded);
  const loaded = await orNotFound(getRates({ includeEnded: showEnded })); // authorize("payroll.view") inside
  const rows = sortLines(
    loaded.map((r) => ({ ...r, runLineId: r.lineKey, confirmedByName: null, sortKeys: { monthly: r.monthlyCentavos, net: null, change: null } })),
    sort,
  );
  const sortLinks: SortLinks = {};
  for (const h of RATE_HEADERS) {
    const next = nextSort(h, sort);
    sortLinks[h] = { href: hrefWith(RATE_SORTS.includes(next) ? next : DEFAULT_SORT), state: headerState(h, sort) };
  }
  const options = can(user, "payroll.manage_rates") ? await orNotFound(getRateOptions()) : null;
  const today = payrollToday();
  // A new pay line starts, by default, on the first day of the cutoff the New run window suggests, so the next run includes it.
  const addStart = recentPeriods("semi_monthly", today, 2)[1].start;

  return (
    <PageContainer width="full">
      <PageHeader title="Payroll" description="Monthly rates and the lines each person is paid on. Each change is a new version with a start date." />
      <PayrollTabs current="rates" />
      <RatesTable
        rows={rows}
        options={options}
        today={today}
        addStart={addStart}
        sortLinks={sortLinks}
        endedToggle={{ showing: showEnded, href: hrefFor(sort, !showEnded) }}
        sortMenu={loaded.length > 1 ? <SortMenu current={SORT_LABELS[sort]} options={RATE_SORTS.map((v) => ({ value: v, label: SORT_LABELS[v], href: hrefWith(v), active: v === sort }))} /> : null}
      />
    </PageContainer>
  );
}
