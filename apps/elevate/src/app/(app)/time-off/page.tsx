import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { TabNav } from "@/components/tab-nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { paginate, parsePaging } from "@/lib/pagination";
import { formatDateOnly } from "@/lib/time";
import { cn } from "@/lib/utils";
import { todayInZone } from "@/modules/org/service";
import { formatDays } from "@/modules/timeoff/ledger";
import { HolidayControls, HOLIDAY_KIND_LABELS, ImportHolidaysButton, LeaveTypeRowForm, NewHolidayForm, NewLeaveTypeForm, VerifyAllHolidaysButton } from "@/modules/timeoff/components/admin-forms";
import { AdjustForm, AwardForm } from "@/modules/timeoff/components/award-forms";
import { BalanceView } from "@/modules/timeoff/components/balance-view";
import { CalendarMonth } from "@/modules/timeoff/components/calendar-view";
import { RequestForm } from "@/modules/timeoff/components/request-form";
import { RequestList } from "@/modules/timeoff/components/request-list";
import { getTeamCalendar, listApprovalQueue, listMyRequests, listRequestTypes } from "@/modules/timeoff/request-queries";
import { getAwardOptions, getHolidays, getMyTimeOff, listBalances, listLeaveTypes } from "@/modules/timeoff/queries";

export const metadata: Metadata = { title: "Time off" };

const ALL_TABS = [
  { key: "mine", label: "My prize days" },
  { key: "requests", label: "Requests" },
  { key: "approvals", label: "Approvals" },
  { key: "calendar", label: "Calendar" },
  { key: "holidays", label: "Holidays" },
  { key: "balances", label: "Balances" },
  { key: "award", label: "Award" },
  { key: "types", label: "Types" },
] as const;

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const weekdayOf = (date: string) => WEEKDAY.format(new Date(`${date}T00:00:00Z`));
const HEAD = "px-5 text-xs font-semibold tracking-wide text-muted-foreground uppercase";

export default async function TimeOffPage({ searchParams }: PageProps<"/time-off">) {
  const user = await requireUser();
  const params = await searchParams;
  const allowed = new Set<string>(["mine", "requests", "calendar", "holidays"]);
  const approve = scopeFor(user, "timeoff.approve");
  if (approve === "all" || approve === "team") allowed.add("approvals");
  if (scopeFor(user, "timeoff.view_overview")) allowed.add("balances");
  if (can(user, "timeoff.award")) allowed.add("award");
  if (can(user, "timeoff.manage_types")) allowed.add("types");
  const tabs = ALL_TABS.filter((t) => allowed.has(t.key));
  const tab = tabs.find((t) => t.key === params.tab)?.key ?? "mine";
  const today = todayInZone();
  const year = Number(params.year) || Number(today.slice(0, 4));
  const paging = parsePaging({ page: params.page, size: params.size });

  // The request button is in the page header, so the leave types are read on every tab. Someone who may not request just gets no button.
  // On the Requests tab itself a failure still shows the error page, so it never reads as "no leave types".
  const requestTypes =
    tab === "requests"
      ? await orNotFound(listRequestTypes())
      : await listRequestTypes().catch((error: unknown) => {
          unstable_rethrow(error);
          return [];
        });
  const mine = tab === "mine" ? await orNotFound(getMyTimeOff()) : null;
  const requests =
    tab === "requests"
      ? {
          types: requestTypes,
          items: await orNotFound(listMyRequests()),
          people: can(user, "timeoff.file_for_others") ? (await orNotFound(getAwardOptions())).people : null,
        }
      : null;
  const approvals = tab === "approvals" ? await orNotFound(listApprovalQueue()) : null;
  const calendar = tab === "calendar" ? await orNotFound(getTeamCalendar(String(params.month ?? ""))) : null;
  const holidays = tab === "holidays" ? await orNotFound(getHolidays(year)) : null;
  const balances = tab === "balances" ? await orNotFound(listBalances()) : null;
  const options = tab === "award" ? await orNotFound(getAwardOptions()) : null;
  const balancePage = balances ? paginate(balances.rows, paging.page, paging.pageSize) : null;
  const holidayPage = holidays ? paginate(holidays.rows, paging.page, paging.pageSize) : null;
  const types = tab === "types" ? await orNotFound(listLeaveTypes()) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Time off"
        description="Prize days off that HR awards, and the holiday calendars."
        actions={
          requestTypes.length > 0 ? (
            <>
              {requests?.people ? (
                <FormDialog label="File for someone" title="File a request for someone" variant="outline" size="lg">
                  <RequestForm types={requestTypes} today={today} people={requests.people} />
                </FormDialog>
              ) : null}
              <FormDialog label="Request time off" title="Request time off" size="lg">
                <RequestForm types={requestTypes} today={today} />
              </FormDialog>
            </>
          ) : null
        }
      />

      <TabNav label="Time off sections" items={tabs.map((t) => ({ key: t.key, label: t.label, href: `/time-off?tab=${t.key}` }))} current={tab} />

      {tab === "mine" ? (
        mine ? (
          <BalanceView data={mine} empty="You have no prize days yet. HR awards them, for example as a game prize." />
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="No people record is linked to your account yet"
            description="So there are no prize days to show."
            action={
              <Link href="/attendance" className={cn(buttonVariants({ variant: "outline" }))}>
                Set up your profile
              </Link>
            }
          />
        )
      ) : null}

      {requests ? (
        <div className="space-y-6">
          {requests.types.length === 0 ? <p className="text-muted-foreground">No leave types are set up yet. Ask HR.</p> : null}
          <section aria-label="My requests" className="space-y-3">
            <h2 className="text-lg font-semibold">My requests</h2>
            <RequestList items={requests.items} empty="You have not made any requests yet. Use Request time off at the top of the page." />
          </section>
        </div>
      ) : null}

      {approvals ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {approvals.scope === "team" ? "Requests from people on your team. You decide the first step; HR decides the last." : "Everything waiting. You decide the HR step; the person's lead decides the first."}
          </p>
          <RequestList items={approvals.items} showPerson empty="Nothing is waiting for approval." />
        </div>
      ) : null}

      {calendar ? <CalendarMonth view={calendar} today={today} /> : null}

      {holidays ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex divide-x overflow-clip rounded-lg border bg-card" role="group" aria-label="Year">
              {[Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1].map((y) => (
                <Link
                  key={y}
                  href={`/time-off?tab=holidays&year=${y}`}
                  aria-current={y === year ? "page" : undefined}
                  className={cn("px-4 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", y === year ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground")}
                >
                  {y}
                </Link>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Showing {holidays.calendars.map((c) => (c === "PH" ? "Philippine" : "US")).join(" and ")} holidays{holidays.canManage ? "" : " that apply to you"}.
            </p>
            {holidays.canManage ? (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <ImportHolidaysButton year={year} />
                <VerifyAllHolidaysButton year={year} count={holidays.rows.filter((h) => !h.verified).length} />
                <FormDialog label="Add a holiday" title="Add a holiday" variant="outline">
                  <NewHolidayForm defaultDate={`${year}-01-01`} />
                </FormDialog>
              </div>
            ) : null}
          </div>
          {holidays.rows.length === 0 ? (
            <EmptyState icon={CalendarDays} title={`No holidays for ${year} yet`} />
          ) : (
            <div className="overflow-clip rounded-2xl border bg-card shadow-sm">
              <ul className="divide-y md:hidden">
                {holidayPage?.rows.map((h) => (
                  <li key={h.id} className="space-y-1.5 px-4 py-3.5 text-sm">
                    <p className="font-medium">
                      {h.name} {h.verified ? null : <Badge variant="warning" className="ml-1">{holidays.canManage ? "Verify" : "Date to be confirmed"}</Badge>}
                    </p>
                    <p className="text-muted-foreground">
                      {weekdayOf(h.date)}, {formatDateOnly(h.date)} · {h.calendar === "PH" ? "Philippines" : "United States"} · {HOLIDAY_KIND_LABELS[h.kind] ?? h.kind}
                    </p>
                    {holidays.canManage ? <HolidayControls holiday={h} /> : null}
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table plain containerClassName="rounded-none border-0 shadow-none">
                  <TableHeader className="bg-secondary/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={HEAD}>Date</TableHead>
                      <TableHead className={HEAD}>Holiday</TableHead>
                      <TableHead className={HEAD}>Calendar</TableHead>
                      <TableHead className={HEAD}>Type</TableHead>
                      {holidays.canManage ? <TableHead className={cn(HEAD, "text-right")}>Manage</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {holidayPage?.rows.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="px-5 py-3 whitespace-nowrap">
                          {weekdayOf(h.date)}, {formatDateOnly(h.date)}
                        </TableCell>
                        <TableCell className="px-5 py-3 whitespace-normal">
                          {h.name} {h.verified ? null : <Badge variant="warning" className="ml-1">{holidays.canManage ? "Verify" : "Date to be confirmed"}</Badge>}
                        </TableCell>
                        <TableCell className="px-5 py-3">{h.calendar === "PH" ? "Philippines" : "United States"}</TableCell>
                        <TableCell className="px-5 py-3">{HOLIDAY_KIND_LABELS[h.kind] ?? h.kind}</TableCell>
                        {holidays.canManage ? (
                          <TableCell className="px-5 py-3">
                            <HolidayControls holiday={h} />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          {holidayPage ? <PagerLinks info={holidayPage.info} basePath="/time-off" query={{ tab: "holidays", year: String(year) }} label="holidays" /> : null}
          {holidays.canManage ? (
            <Alert variant="info" role="note">
              <AlertDescription>
                The government proclaims Philippine holidays each year, so those dates start as &quot;Verify&quot;. A day only counts (no absence flag, not a leave day, shown on calendars) once you tick &quot;Mark checked&quot;: check each against the official proclamation and add any that are missing. Import adds public holidays from Nager.Date that are missing; Philippine ones start as &quot;Verify&quot; and do not count until you mark them checked.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {balances ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{balances.scope === "team" ? "People on your team who hold prize days." : "Everyone who holds prize days."}</p>
          {balances.rows.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Nobody holds prize days yet" />
          ) : (
            <div className="overflow-clip rounded-2xl border bg-card shadow-sm">
              <ul className="divide-y md:hidden">
                {balancePage?.rows.map((r) => (
                  <li key={r.employeeId}>
                    <Link href={`/time-off/${r.employeeId}`} className="flex items-start justify-between gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <span className="min-w-0">
                        <span className="block font-medium">{r.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.employeeNumber} · {r.team ?? "No team"}
                        </span>
                        <span className="block text-xs text-muted-foreground">{r.nextExpiry ? `Next expiry ${formatDateOnly(r.nextExpiry)}` : "No expiry"}</span>
                      </span>
                      <span className="font-heading text-xl font-bold tabular-nums">{formatDays(r.balance)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table plain containerClassName="rounded-none border-0 shadow-none">
                  <TableHeader className="bg-secondary/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={HEAD}>Person</TableHead>
                      <TableHead className={HEAD}>Team</TableHead>
                      <TableHead className={cn(HEAD, "text-right")}>Balance</TableHead>
                      <TableHead className={HEAD}>Next expiry</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balancePage?.rows.map((r) => (
                      <TableRow key={r.employeeId}>
                        <TableCell className="px-5 py-3">
                          <Link href={`/time-off/${r.employeeId}`} className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
                            {r.name}
                          </Link>{" "}
                          <span className="text-muted-foreground">{r.employeeNumber}</span>
                        </TableCell>
                        <TableCell className="px-5 py-3 text-muted-foreground">{r.team ?? "No team"}</TableCell>
                        <TableCell className="px-5 py-3 text-right font-semibold tabular-nums">{formatDays(r.balance)}</TableCell>
                        <TableCell className="px-5 py-3 text-muted-foreground">{r.nextExpiry ? formatDateOnly(r.nextExpiry) : "None"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          {balancePage ? <PagerLinks info={balancePage.info} basePath="/time-off" query={{ tab: "balances" }} label="people" /> : null}
        </div>
      ) : null}

      {options ? (
        <div className="space-y-6">
          {options.types.length === 0 ? (
            <p className="text-muted-foreground">Add a leave type that has a balance on the Types tab first.</p>
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <AwardForm people={options.people} types={options.types} today={today} />
              <AdjustForm people={options.people} types={options.types} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">You cannot award or correct your own days: another admin must do it. Every entry is logged.</p>
        </div>
      ) : null}

      {types ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            A type that &quot;draws from a balance&quot; is filled by awards. One without a balance (an unpaid day off) is only tracked. Retiring a type keeps its history.
          </p>
          <NewLeaveTypeForm />
          <ul className="divide-y rounded-2xl border bg-card px-5 shadow-sm">
            {types.map((t) => (
              <LeaveTypeRowForm key={t.id} type={t} />
            ))}
          </ul>
        </div>
      ) : null}
    </PageContainer>
  );
}
