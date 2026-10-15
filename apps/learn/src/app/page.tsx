import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getSql, withUser } from "@/lib/db";
import { getPractice, listAssignments } from "@/lib/queries";

export const dynamic = "force-dynamic";

const TRACK_LABEL: Record<string, string> = { full: "Full course", essentials: "Essentials", refresher: "Refresher" };
const STATUS_LABEL: Record<string, string> = { assigned: "Not started", in_progress: "In progress", passed: "Passed", expired: "Expired", cancelled: "Cancelled" };
const ACTION_LABEL: Record<string, string> = { assigned: "Start", in_progress: "Continue", passed: "View", expired: "View", cancelled: "View" };

export default async function Home() {
  const session = await requireSession();
  const sql = getSql();
  const person = await withUser(sql, session.userId, async (tx) => (await tx`select display_name from learn.v_learners`)[0] as { display_name: string } | undefined);
  const assignments = await listAssignments(sql, session.userId);
  const practice = await getPractice(sql, session.userId);
  const practiceOpen = practice.filter((x) => !x.answered).length;

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
      {practiceOpen > 0 ? (
        <section className="card">
          <strong>Quarterly practice</strong>
          <p className="muted">A two-minute scenario is ready. It is not a test.</p>
          <p>
            <Link className="button" href="/practice">
              Try it
            </Link>
          </p>
        </section>
      ) : null}
      <p>
        <Link href="/record">My training record</Link>
        ·{" "}
        <Link href="/cards">Quick-reference cards</Link>
      </p>
      <form method="post" action="/auth/signout">
        <button type="submit" className="secondary">
          Sign out of training
        </button>
      </form>
    </>
  );
}
