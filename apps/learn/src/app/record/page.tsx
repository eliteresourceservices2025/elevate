import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getRecord } from "@/lib/queries";

export const dynamic = "force-dynamic";

const TRACK_LABEL: Record<string, string> = { full: "Full course", essentials: "Essentials", refresher: "Refresher" };
const STATUS_LABEL: Record<string, string> = { assigned: "Not started", in_progress: "In progress", passed: "Passed", expired: "Expired", cancelled: "Cancelled" };

/** The person's own training record: every course they were assigned, what they finished, their certificates and time spent. */
export default async function RecordPage() {
  const session = await requireSession();
  const entries = await getRecord(getSql(), session.userId);
  const minutes = entries.reduce((sum, e) => sum + e.minutesSpent, 0);

  return (
    <>
      <p className="muted">
        <Link href="/">Back to my training</Link>
      </p>
      <h1>My training record</h1>
      {entries.length > 0 ? (
        <p className="no-print">
          <a className="button secondary" href="/api/record/pdf" download>
            Download my record (PDF)
          </a>
        </p>
      ) : null}
      <p className="muted">
        Everything you have done in ELEVATE Learn. Only you, HR and the privacy team can see your scores; your lead sees only whether you have passed.
      </p>
      {entries.length === 0 ? (
        <p>You have no training on record yet.</p>
      ) : (
        <>
          <p className="muted small">
            {entries.length} {entries.length === 1 ? "course" : "courses"} on record · about {minutes} minutes of training time.
          </p>
          <ul className="plain">
            {entries.map((e) => (
              <li key={e.assignmentId} className="card">
                <strong>{e.courseTitle}</strong>
                <div className="muted">
                  Version {e.version} · {TRACK_LABEL[e.track] ?? e.track} · {STATUS_LABEL[e.status] ?? e.status}
                </div>
                <div className="muted small">
                  Assigned {e.assignedOn} · due {e.dueOn}
                  {e.passedOn ? ` · passed ${e.passedOn}` : ""}
                </div>
                <div className="muted small">
                  Time spent about {e.minutesSpent} minutes
                  {e.attempts > 0 ? ` · ${e.attempts} exam ${e.attempts === 1 ? "try" : "tries"}` : ""}
                  {e.scorePercent !== null ? ` · score ${Math.round(e.scorePercent * 10) / 10}%` : ""}
                </div>
                {e.certificate ? (
                  <div className="small">
                    Certificate <strong>{e.certificate.reference}</strong>: issued {e.certificate.issuedOn}, valid until {e.certificate.endsOn}
                    {e.certificate.revoked ? " (revoked)" : ""}
                  </div>
                ) : null}
                <p>
                  <Link className="button secondary" href={`/course/${e.assignmentId}`}>
                    Open
                  </Link>{" "}
                  {e.certificate && !e.certificate.revoked ? (
                    <a className="button" href={`/api/certificate/${e.assignmentId}`} download>
                      Download certificate PDF
                    </a>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
