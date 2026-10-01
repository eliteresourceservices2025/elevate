import { runMissedClockouts } from "@/modules/attendance/jobs";
import { runHealthCheck } from "@/modules/health/service";
import { cronAuthorized } from "@/modules/health/registry";
import { processMirrorQueue, runJibbleRepair } from "@/modules/jibble/jobs";

// The host's own scheduler (vercel.json) calls this every 15 minutes, so the jobs that matter most for attendance still run when the
// job service (Inngest) is down: the health check (which tells HR), sending waiting calls to Jibble, putting Jibble right, and
// missed clock-out notices. Every one of them is safe to run twice. It is outside the sign-in gate (api routes are), so it checks
// the CRON_SECRET itself, in constant time; with no secret set nobody is let in.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) return new Response("Not authorized", { status: 401 });
  const health = await runHealthCheck();
  const mirror = await processMirrorQueue();
  const repair = await runJibbleRepair();
  const missed = await runMissedClockouts();
  return Response.json({ ok: true, health: { lateJobs: health.lateJobs.length, queueMinutes: health.queueMinutes }, mirror, repair, missed });
}
