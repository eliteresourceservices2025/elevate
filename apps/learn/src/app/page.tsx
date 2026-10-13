import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSql, withUser } from "@/lib/db";
import { resolveSession } from "@/lib/handlers";
import { elevateUrl } from "@/lib/origin";

export const dynamic = "force-dynamic";

type Row = { id: string; title: string; track: string; due_on: string; status: string };

const TRACK_LABEL: Record<string, string> = { full: "Full course", essentials: "Essentials", refresher: "Refresher" };
const STATUS_LABEL: Record<string, string> = { assigned: "Not started", in_progress: "In progress", passed: "Passed", expired: "Expired", cancelled: "Cancelled" };

export default async function Home() {
  const production = process.env.NODE_ENV === "production";
  const sql = getSql();
  const session = await resolveSession((await headers()).get("cookie"), { sql, production });
  if (!session) {
    // No session: ask ELEVATE to sign the person in and send them back here.
    const elevate = elevateUrl();
    if (!elevate) return <p>Training is not available right now. Please contact HR.</p>;
    redirect(`${elevate}/learn?auto=1`);
  }

  const { person, assignments } = await withUser(sql, session.userId, async (tx) => {
    const people = await tx`select display_name from learn.v_learners`;
    const rows = (await tx`
      select a.id, c.title, a.track, a.due_on::text as due_on, a.status
      from learn.assignments a join learn.courses c on c.id = a.course_id
      order by a.assigned_at desc`) as unknown as Row[];
    return { person: people[0] as { display_name: string } | undefined, assignments: rows };
  });

  return (
    <>
      <h1>Hello{person ? `, ${person.display_name}` : ""}</h1>
      {assignments.length === 0 ? (
        <p>You have no training assigned yet. If you expected something here, please ask HR.</p>
      ) : (
        <ul className="plain">
          {assignments.map((a) => (
            <li key={a.id} className="card">
              <strong>{a.title}</strong>
              <div className="muted">
                {TRACK_LABEL[a.track] ?? a.track} · due {a.due_on} · {STATUS_LABEL[a.status] ?? a.status}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form method="post" action="/auth/signout">
        <button type="submit">Sign out of training</button>
      </form>
    </>
  );
}
