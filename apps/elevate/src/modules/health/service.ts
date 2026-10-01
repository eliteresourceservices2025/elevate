import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { JOBS, jobState } from "./registry";

// Job check-ins and the health check. Background code (no signed-in person); callers are the job service and the host's cron.

/**
 * Runs one scheduled job and records that it ran. A failure to write the check-in never breaks the job, and the job's own error
 * is rethrown unchanged so the job service still retries it. Only the error's class name is stored.
 */
export async function trackJob<T>(job: string, fn: () => Promise<T>): Promise<T> {
  await db.execute(sql`insert into ops.job_runs (job, last_started_at, runs) values (${job}, now(), 1) on conflict (job) do update set last_started_at = now(), runs = ops.job_runs.runs + 1`).catch(() => undefined);
  try {
    const result = await fn();
    await db.execute(sql`update ops.job_runs set last_success_at = now() where job = ${job}`).catch(() => undefined);
    return result;
  } catch (error) {
    await db.execute(sql`update ops.job_runs set last_error_at = now(), last_error = ${error instanceof Error ? error.name.slice(0, 80) : "Error"} where job = ${job}`).catch(() => undefined);
    throw error;
  }
}

export type JobHealth = { job: string; label: string; everyMinutes: number; lastSuccessAt: string | null; lastErrorAt: string | null; lastError: string | null; state: "ok" | "late" | "failing" | "waiting" };

/** Every known job with how it is doing. A job with no check-in yet is "waiting". */
export async function jobHealth(now = new Date()): Promise<JobHealth[]> {
  const rows = (await db.execute(sql`select job, last_success_at, last_error_at, last_error from ops.job_runs`)) as unknown as { job: string; last_success_at: Date | null; last_error_at: Date | null; last_error: string | null }[];
  const byJob = new Map(rows.map((r) => [r.job, r]));
  return Object.entries(JOBS).map(([job, info]) => {
    const r = byJob.get(job);
    const lastSuccessMs = r?.last_success_at ? new Date(r.last_success_at).getTime() : null;
    const lastErrorMs = r?.last_error_at ? new Date(r.last_error_at).getTime() : null;
    return {
      job,
      label: info.label,
      everyMinutes: info.everyMinutes,
      lastSuccessAt: lastSuccessMs === null ? null : new Date(lastSuccessMs).toISOString(),
      lastErrorAt: lastErrorMs === null ? null : new Date(lastErrorMs).toISOString(),
      lastError: r?.last_error ?? null,
      state: jobState({ everyMinutes: info.everyMinutes, lastSuccessMs, lastErrorMs, nowMs: now.getTime() }),
    };
  });
}

/** HR hears about system trouble at most once in the window. */
async function alertHr(title: string, body: string, windowHours: number): Promise<boolean> {
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const [recent] = (await db.execute(sql`select 1 as ok from ops.notifications where kind = 'system.health' and created_at > ${since}::timestamptz limit 1`)) as unknown as { ok: number }[];
  if (recent) return false;
  const hr = await hrUserIds();
  await notify(db, hr.map((userId) => ({ userId, kind: "system.health", title, body, link: "/attendance?tab=health" })));
  return true;
}

export type HealthCheck = { lateJobs: string[]; queueMinutes: number | null; alerted: boolean };

/**
 * Every 30 minutes (by the job service and again by the host's own scheduler): HR is told once every 6 hours when a scheduled job
 * has stopped running, or when a call to Jibble has waited 15 minutes or more. This is the one job that works even when the job
 * service is down, because the host's cron also runs it.
 */
export async function runHealthCheck(now = new Date()): Promise<HealthCheck> {
  const late = (await jobHealth(now)).filter((j) => j.state === "late" && j.job !== "health-check");
  const [q] = (await db.execute(sql`
    select (extract(epoch from now() - min(created_at)) / 60)::float8 as oldest from time.jibble_link_log where status = 'queued'
      and not coalesce((select paused from time.jibble_settings where id = 1), false)`)) as unknown as { oldest: number | null }[];
  const queueMinutes = q?.oldest === null || q?.oldest === undefined ? null : Math.round(Number(q.oldest));
  const queueLate = queueMinutes !== null && queueMinutes >= 15;

  let alerted = false;
  if (late.length > 0 || queueLate) {
    const parts = [
      late.length > 0 ? `${late.length} scheduled ${late.length === 1 ? "job has" : "jobs have"} stopped running: ${late.slice(0, 5).map((j) => j.label).join(", ")}${late.length > 5 ? ", and more" : ""}.` : null,
      queueLate ? `A clock call to Jibble has waited ${queueMinutes} minutes.` : null,
    ].filter(Boolean);
    alerted = await alertHr("ELEVATE needs a look", `${parts.join(" ")} See the Health tab.`, 6);
  }
  return { lateJobs: late.map((j) => j.job), queueMinutes, alerted };
}
