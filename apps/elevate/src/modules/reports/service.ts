import "server-only";
import { sql } from "drizzle-orm";
import { ForbiddenError, authorize, type AuthzUser } from "@/lib/authz";
import type { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { hrUserIds } from "@/modules/notifications/service";
import { reportName, timeChainUserIds } from "@/modules/org/service";
import type { ReportType } from "./constants";

// Who may talk on a report: the person it is about (the "reporter") and whoever may handle that kind of report (a "handler"). Server-only helpers
// (not server actions, so they take the acting user). Callers rate-limit.

type Executor = Pick<typeof db, "execute">;

export type ReportStanding = {
  standing: "reporter" | "handler";
  /** The sign-in account of the person the report is about (null when they have none). */
  reporterUserId: string | null;
  reporterName: string;
  /** The first lead above them (or nobody): who is told when the reporter writes, before falling back to HR. */
  leadUserIds: string[];
};

type Subject = { employeeId: string; userId: string | null; name: string };
type EmployeeTable = "time.tech_issue_reports" | "time.clock_corrections" | "time.extra_hours_requests" | "time.makeup_requests" | "time.leave_requests";

async function employeeSubject(executor: Executor, table: EmployeeTable, id: string): Promise<Subject | null> {
  const [row] = (await executor.execute(sql`
    select e.id as employee_id, e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from ${sql.raw(table)} r join core.employees e on e.id = r.employee_id where r.id = ${id}`)) as unknown as { employee_id: string; user_id: string | null; first: string; last: string; preferred: string | null }[];
  return row ? { employeeId: row.employee_id, userId: row.user_id, name: reportName({ first: row.first, last: row.last, preferred: row.preferred }) } : null;
}

const TABLES: Record<Exclude<ReportType, "support">, EmployeeTable> = {
  tech_issue: "time.tech_issue_reports",
  correction: "time.clock_corrections",
  extra_hours: "time.extra_hours_requests",
  makeup: "time.makeup_requests",
  time_off: "time.leave_requests",
};

/** What the viewer is to this report, or ForbiddenError when they are neither the person nor a handler. ActionFailure when it does not exist. */
export async function resolveReport(executor: Executor, actor: AuthzUser, type: ReportType, id: string): Promise<ReportStanding> {
  if (type === "support") {
    const [row] = (await executor.execute(sql`
      select s.user_id, coalesce(nullif(trim(e.legal_first_name || ' ' || e.legal_last_name), ''), u.email) as name
      from ops.support_requests s join core.users u on u.id = s.user_id left join core.employees e on e.user_id = s.user_id
      where s.id = ${id}`)) as unknown as { user_id: string; name: string }[];
    if (!row) throw new ActionFailure("That request was not found.");
    if (row.user_id === actor.id) return { standing: "reporter", reporterUserId: row.user_id, reporterName: row.name, leadUserIds: [] };
    await authorize(actor, "support.manage");
    return { standing: "handler", reporterUserId: row.user_id, reporterName: row.name, leadUserIds: [] };
  }

  const subject = await employeeSubject(executor, TABLES[type], id);
  if (!subject) throw new ActionFailure("That request was not found.");
  const chain = await timeChainUserIds(executor as never, subject.employeeId);
  const base = { reporterUserId: subject.userId, reporterName: subject.name, leadUserIds: chain.slice(0, 1) };
  if (subject.userId === actor.id) return { standing: "reporter", ...base };

  const resource = { ownerUserId: subject.userId ?? undefined, managerChainUserIds: chain };
  switch (type) {
    case "tech_issue":
      await authorize(actor, "attendance.handle_issue", resource);
      break;
    case "correction":
      await authorize(actor, "attendance.approve_correction", resource);
      break;
    case "extra_hours":
      await authorize(actor, "extra_hours.decide", resource);
      break;
    case "makeup":
      await authorize(actor, "makeup.decide", resource);
      break;
    case "time_off":
      try {
        await authorize(actor, "timeoff.approve", resource);
      } catch (error) {
        if (!(error instanceof ForbiddenError)) throw error;
        await authorize(actor, "timeoff.approve_final");
      }
      break;
  }
  return { standing: "handler", ...base };
}

/** Who to tell when the reporter writes: the lead above them (if any) and otherwise HR. Never the writer. */
export async function handlersToTell(standing: ReportStanding, actorId: string): Promise<string[]> {
  const ids = standing.leadUserIds.length > 0 ? standing.leadUserIds : await hrUserIds();
  return ids.filter((id) => id !== actorId);
}
