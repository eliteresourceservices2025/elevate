import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { formatDateOnly } from "@/lib/time";
import { cn } from "@/lib/utils";
import { todayInZone } from "@/modules/org/service";
import { formatDays } from "@/modules/timeoff/ledger";
import { HolidayControls, HOLIDAY_KIND_LABELS, LeaveTypeRowForm, NewHolidayForm, NewLeaveTypeForm } from "@/modules/timeoff/components/admin-forms";
import { AdjustForm, AwardForm } from "@/modules/timeoff/components/award-forms";
import { BalanceView } from "@/modules/timeoff/components/balance-view";
import { getAwardOptions, getHolidays, getMyTimeOff, listBalances, listLeaveTypes } from "@/modules/timeoff/queries";

export const metadata: Metadata = { title: "Time off" };

const ALL_TABS = [
  { key: "mine", label: "My prize days" },
  { key: "holidays", label: "Holidays" },
  { key: "balances", label: "Balances" },
  { key: "award", label: "Award" },
  { key: "types", label: "Types" },
] as const;

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const weekdayOf = (date: string) => WEEKDAY.format(new Date(`${date}T00:00:00Z`));

export default async function TimeOffPage({ searchParams }: PageProps<"/time-off">) {
  const user = await requireUser();
  const params = await searchParams;
  const allowed = new Set<string>(["mine", "holidays"]);
  if (scopeFor(user, "timeoff.view_overview")) allowed.add("balances");
  if (can(user, "timeoff.award")) allowed.add("award");
  if (can(user, "timeoff.manage_types")) allowed.add("types");
  const tabs = ALL_TABS.filter((t) => allowed.has(t.key));
  const tab = tabs.find((t) => t.key === params.tab)?.key ?? "mine";
  const today = todayInZone();
  const year = Number(params.year) || Number(today.slice(0, 4));

  const mine = tab === "mine" ? await orNotFound(getMyTimeOff()) : null;
  const holidays = tab === "holidays" ? await orNotFound(getHolidays(year)) : null;
  const balances = tab === "balances" ? await orNotFound(listBalances()) : null;
  const options = tab === "award" ? await orNotFound(getAwardOptions()) : null;
  const types = tab === "types" ? await orNotFound(listLeaveTypes()) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Time off</h1>
        <p className="mt-1 text-muted-foreground">Prize days off that HR awards, and the holiday calendars.</p>
      </div>

      <nav aria-label="Time off sections" className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/time-off?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn("-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm", t.key === tab ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "mine" ? (
        mine ? (
          <BalanceView data={mine} empty="You have no prize days yet. HR awards them, for example as a game prize." />
        ) : (
          <p className="text-muted-foreground">No people record is linked to your account yet, so there are no prize days to show.</p>
        )
      ) : null}

      {holidays ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1" role="group" aria-label="Year">
              {[Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1].map((y) => (
                <Link key={y} href={`/time-off?tab=holidays&year=${y}`} aria-current={y === year ? "page" : undefined} className={cn("rounded-lg border px-3 py-1 text-sm", y === year ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>
                  {y}
                </Link>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Showing {holidays.calendars.map((c) => (c === "PH" ? "Philippine" : "US")).join(" and ")} holidays{holidays.canManage ? "" : " that apply to you"}.
            </p>
          </div>
          {holidays.rows.length === 0 ? (
            <p className="text-muted-foreground">No holidays for {year} yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Holiday</TableHead>
                    <TableHead>Calendar</TableHead>
                    <TableHead>Type</TableHead>
                    {holidays.canManage ? <TableHead className="text-right">Manage</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holidays.rows.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap">
                        {weekdayOf(h.date)}, {formatDateOnly(h.date)}
                      </TableCell>
                      <TableCell>
                        {h.name} {h.verified ? null : <Badge variant="secondary" className="ml-1">{holidays.canManage ? "Verify" : "Date to be confirmed"}</Badge>}
                      </TableCell>
                      <TableCell>{h.calendar === "PH" ? "Philippines" : "United States"}</TableCell>
                      <TableCell>{HOLIDAY_KIND_LABELS[h.kind] ?? h.kind}</TableCell>
                      {holidays.canManage ? (
                        <TableCell>
                          <HolidayControls holiday={h} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {holidays.canManage ? (
            <>
              <p className="text-sm text-muted-foreground">
                The government proclaims Philippine holidays each year, so those dates start as &quot;Verify&quot;: check them against the official proclamation and add any that are missing.
              </p>
              <NewHolidayForm defaultDate={`${year}-01-01`} />
            </>
          ) : null}
        </div>
      ) : null}

      {balances ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{balances.scope === "team" ? "People on your team who hold prize days." : "Everyone who holds prize days."}</p>
          {balances.rows.length === 0 ? (
            <p className="text-muted-foreground">Nobody holds prize days yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Next expiry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.rows.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell>
                        <Link href={`/time-off/${r.employeeId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                          {r.name}
                        </Link>{" "}
                        <span className="text-muted-foreground">{r.employeeNumber}</span>
                      </TableCell>
                      <TableCell>{r.team ?? "No team"}</TableCell>
                      <TableCell className="text-right">{formatDays(r.balance)}</TableCell>
                      <TableCell>{r.nextExpiry ? formatDateOnly(r.nextExpiry) : "None"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : null}

      {options ? (
        <div className="space-y-6">
          {options.types.length === 0 ? (
            <p className="text-muted-foreground">Add a leave type that has a balance on the Types tab first.</p>
          ) : (
            <>
              <AwardForm people={options.people} types={options.types} today={today} />
              <AdjustForm people={options.people} types={options.types} />
            </>
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
          <ul className="divide-y rounded-xl border bg-card px-4">
            {types.map((t) => (
              <LeaveTypeRowForm key={t.id} type={t} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
