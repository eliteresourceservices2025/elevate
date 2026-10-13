import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getSql, withUser } from "@/lib/db";
import { listAssignments } from "@/lib/queries";

export const dynamic = "force-dynamic";

const TRACK_LABEL: Record<string, string> = { full: "Full course", essentials: "Essentials", refresher: "Refresher" };
const STATUS_LABEL: Record<string, string> = { assigned: "Not started", in_progress: "In progress", passed: "Passed", expired: "Expired", cancelled: "Cancelled" };
const ACTION_LABEL: Record<string, string> = { assigned: "Start", in_progress: "Continue", passed: "View", expired: "View", cancelled: "View" };

export default async function Home() {
  const session = await requireSession();
  const sql = getSql();
  const person = await withUser(sql, session.userId, async (tx) => (await tx`select display_name from learn.v_learners`)[0] as { display_name: string } | undefined);
  const assignments = await listAssignments(sql, session.userId);

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
                {TRACK_LABEL[a.track] ?? a.track} · due {a.dueOn} · {STATUS_LABEL[a.status] ?? a.status}
              </div>
              <p>
                <Link className="button" href={`/course/${a.id}`}>
                  {ACTION_LABEL[a.status] ?? "Open"}
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/record">My training record</Link>
      </p>
      <form method="post" action="/auth/signout">
        <button type="submit" className="secondary">
          Sign out of training
        </button>
      </form>
    </>
  );
}
