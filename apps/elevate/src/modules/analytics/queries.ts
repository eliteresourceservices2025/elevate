import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { authorize, can, scopeFor, type AuthzUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { NIL_UUID, type DimKind } from "./constants";
import { addDays, monthStart, rangeStart } from "./dates";
import { attendanceWeekly, funnelMonthly, headcountDaily, leaveMonthly, movementMonthly, timeToHireMonthly } from "./schema";
import { isSmall } from "./suppress";
import { parseDashboardParams } from "./validators";
import { attendancePoints, breakdown, headcountPoints, hiringView, leavePoints, movementPoints, type Breakdown, type Dashboard, type PeopleView } from "./view";

// Reads the nightly summary tables for the dashboards. Every query starts with requireUser() and authorize(). Aggregates only: the
// tables hold no row about a person, and small groups are hidden here (view.ts) before anything is returned.

const rowsOf = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

async function groupNames(table: "teams" | "clients", asOf: string): Promise<Breakdown> {
  const kind: DimKind = table === "teams" ? "team" : "client";
  const rows =
    table === "teams"
      ? await rowsOf<{ id: string; name: string; headcount: number }>(sql`select h.dim_id as id, t.name, h.headcount from ops.analytics_headcount_daily h join core.teams t on t.id = h.dim_id where h.date = ${asOf}::date and h.dim_kind = ${kind} and t.archived_at is null`)
      : await rowsOf<{ id: string; name: string; headcount: number }>(sql`select h.dim_id as id, c.name, h.headcount from ops.analytics_headcount_daily h join core.clients c on c.id = h.dim_id where h.date = ${asOf}::date and h.dim_kind = ${kind} and c.archived_at is null`);
  return breakdown(rows); // small groups are merged here: their names never leave this function
}

/** The signed-in person's own people record, for a team lead's "my team" scope. */
async function ownEmployeeId(user: AuthzUser): Promise<string | null> {
  const [row] = await rowsOf<{ id: string }>(sql`select id from core.employees where user_id = ${user.id} and archived_at is null limit 1`);
  return row?.id ?? null;
}

/**
 * The dashboard data for the signed-in person. HR, Super Admin and the Executive see the company and may pick a team or client with
 * at least 5 people; a team lead sees only their own downline; a recruiter sees hiring only. Throws ForbiddenError for everyone else.
 */
export async function getDashboard(rawParams: unknown, opts: { hiring?: boolean } = {}): Promise<Dashboard> {
  const user = await requireUser();
  // A team lead passes through their own chain: the downline they see is, by definition, below them.
  const mayPeople = can(user, "analytics.view", { managerChainUserIds: [user.id] });
  if (!mayPeople) await authorize(user, "analytics.view_hiring");
  // The home dashboard only needs the people half and passes hiring: false, which saves a chain of queries.
  const mayHiring = can(user, "analytics.view_hiring") && opts.hiring !== false;
  const wholeCompany = mayPeople && scopeFor(user, "analytics.view") === "all";

  const params = parseDashboardParams(rawParams);
  const [latest] = await rowsOf<{ d: string | null }>(sql`select max(date)::text as d from ops.analytics_headcount_daily where dim_kind = 'company'`);
  const asOf = latest?.d ?? null;
  const empty: Dashboard = { asOf, rangeMonths: params.range, scope: { value: "company", label: "Whole company" }, scopeOptions: [], people: null, peopleNote: null, teams: null, clients: null, hiring: null };
  if (!asOf) return { ...empty, peopleNote: "No snapshot yet. The nightly job builds the first one, about a year of history, when it first runs." };
  const from = rangeStart(asOf, params.range);

  const out: Dashboard = { ...empty };

  if (mayPeople) {
    let kind: DimKind = "company";
    let dimId = NIL_UUID;
    let label = "Whole company";
    let hiddenScope = false;
    if (wholeCompany) {
      const [teams, clients] = await Promise.all([groupNames("teams", asOf), groupNames("clients", asOf)]);
      out.teams = teams;
      out.clients = clients;
      out.scopeOptions = [
        { value: "company", label: "Whole company" },
        ...teams.rows.map((r) => ({ value: `team:${r.id}`, label: `Team: ${r.name}` })),
        ...clients.rows.map((r) => ({ value: `client:${r.id}`, label: `Client: ${r.name}` })),
      ];
      const sel = params.scope;
      if (sel.id) {
        const choice = out.scopeOptions.find((o) => o.value === `${sel.kind}:${sel.id}`);
        kind = sel.kind;
        dimId = sel.id;
        if (choice) label = choice.label;
        else {
          // Not in the list means the group is too small, or too small to be told apart from the rest: its numbers stay hidden.
          hiddenScope = true;
          label = sel.kind === "team" ? "A team" : "A client";
        }
      }
    } else {
      const own = await ownEmployeeId(user);
      if (!own) {
        out.peopleNote = "Your account has no people record, so there is no team to show.";
      } else {
        kind = "downline";
        dimId = own;
        label = "Your team (everyone below you)";
      }
    }
    out.scope = { value: kind === "company" ? "company" : kind === "downline" ? "downline" : `${kind}:${dimId}`, label };

    if (!out.peopleNote) {
      if (hiddenScope) {
        out.people = { hidden: true, headcountNow: null, headcount: [], movement: [], leave: [], attendance: [] };
      } else {
        const dim = (t: typeof headcountDaily | typeof movementMonthly | typeof leaveMonthly | typeof attendanceWeekly) => and(eq(t.dimKind, kind), eq(t.dimId, dimId));
        // Four independent reads: one round trip, not four.
        const [hc, mv, lv, at] = await Promise.all([
          db.select().from(headcountDaily).where(and(dim(headcountDaily), gte(headcountDaily.date, addDays(from, -1)))),
          db.select().from(movementMonthly).where(and(dim(movementMonthly), gte(movementMonthly.month, from))),
          db.select().from(leaveMonthly).where(and(dim(leaveMonthly), gte(leaveMonthly.month, from))),
          db.select().from(attendanceWeekly).where(and(dim(attendanceWeekly), gte(attendanceWeekly.weekStart, from))),
        ]);
        const now_ = hc.find((r) => r.date === asOf)?.headcount ?? 0;
        const points = headcountPoints(hc, from, asOf);
        const view: PeopleView = {
          hidden: isSmall(now_) && kind !== "company" ? true : false,
          headcountNow: isSmall(now_) ? null : now_,
          headcount: points,
          movement: movementPoints(mv.map((r) => ({ month: r.month, joiners: r.joiners, leavers: r.leavers, avgHeadcount: Number(r.avgHeadcount), endHeadcount: r.endHeadcount })), from, asOf),
          leave: leavePoints(lv.map((r) => ({ month: r.month, daysUsed: Number(r.daysUsed), groupSize: r.groupSize })), from, asOf, new Map(mv.map((r) => [r.month, r.endHeadcount]))),
          attendance: attendancePoints(at, from, asOf),
        };
        out.people = view;
      }
    }
  }

  if (mayHiring) {
    const fromMonth = monthStart(from);
    const [funnel, hires, titleRows] = await Promise.all([
      db.select().from(funnelMonthly).where(gte(funnelMonthly.month, fromMonth)),
      db.select().from(timeToHireMonthly).where(gte(timeToHireMonthly.month, fromMonth)),
      rowsOf<{ id: string; title: string }>(sql`select id, title from talent.job_openings`),
    ]);
    const titles = new Map(titleRows.map((r) => [r.id, r.title]));
    out.hiring = hiringView(funnel, hires.map((r) => ({ month: r.month, openingId: r.openingId, hires: r.hires, totalDays: Number(r.totalDays), medianDays: Number(r.medianDays) })), titles, from, asOf);
  }
  return out;
}
