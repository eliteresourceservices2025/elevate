import Link from "next/link";
import { notFound } from "next/navigation";
import { StartExamButton } from "@/components/forms";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const session = await requireSession();
  const overview = await getOverview(getSql(), session.userId, assignmentId);
  if (!overview) notFound();
  const { assignment, modules, exam, certificate } = overview;
  const doneCount = modules.filter((m) => m.completed).length;
  const finished = assignment.status === "passed";
  const next = modules.find((m) => !m.completed && !m.locked);

  return (
    <>
      <p className="muted">
        <Link href="/">My training</Link>
      </p>
      <h1>{assignment.isUpdate ? `${assignment.courseTitle}: update` : assignment.courseTitle}</h1>
      {assignment.isUpdate ? <p>Some lessons changed since you were certified. Read the ones below, then answer a few questions. Your certificate stays valid.</p> : null}
      <p className="muted">
        {doneCount} of {modules.length} modules done · due {assignment.dueOn}
      </p>

      <ol className="plain modules">
        {modules.map((m) => (
          <li key={m.key} className={`card module${m.completed ? " done" : ""}${m.locked ? " locked" : ""}`}>
            <div className="row">
              <strong>
                {m.position}. {m.title}
              </strong>
              <span className="muted">{m.completed ? "Done" : m.locked ? "Locked" : m.seconds > 0 ? "In progress" : "Not started"}</span>
            </div>
            <p className="muted">{m.summary}</p>
            <p className="muted">About {m.estimatedMinutes} minutes · {m.screenCount} screens</p>
            {!m.locked && !finished ? (
              <Link className={m.completed ? "button secondary" : "button"} href={`/course/${assignment.id}/${m.key}`}>
                {m.completed ? "Review" : m.seconds > 0 ? "Continue" : "Start"}
              </Link>
            ) : null}
            {m.locked ? <p className="muted">Finish the earlier modules to open this one.</p> : null}
          </li>
        ))}
      </ol>

      <section className="card" aria-labelledby="exam-h">
        <h2 id="exam-h">{assignment.isUpdate ? "Update questions" : "Final exam"}</h2>
        <p>
          {exam.questions} questions · {exam.minutes ? `${exam.minutes} minutes` : "no time limit"} · {exam.passPercent}% to pass · {exam.triesAllowed} tries
        </p>
        {exam.attempts.filter((a) => a.status === "submitted").length > 0 ? (
          <ul>
            {exam.attempts
              .filter((a) => a.status === "submitted")
              .map((a) => (
                <li key={a.id}>
                  Try {a.attemptNo}: {a.scorePercent}% {a.passed ? "(passed)" : "(not yet)"} · <Link href={`/exam/${a.id}`}>see the result</Link>
                </li>
              ))}
          </ul>
        ) : null}
        {assignment.isUpdate && finished ? (
          assignment.accepted ? (
            <p className="feedback good">You are up to date. Nothing more to do.</p>
          ) : (
            <p>
              <Link className="button" href={`/certificate/${assignment.id}`}>
                Accept the update
              </Link>
            </p>
          )
        ) : certificate ? (
          <p>
            <Link className="button" href={`/certificate/${assignment.id}`}>
              View my certificate
            </Link>
          </p>
        ) : finished ? (
          <p>
            <Link className="button" href={`/certificate/${assignment.id}`}>
              Accept and get my certificate
            </Link>
          </p>
        ) : exam.openAttemptId ? (
          <p>
            <Link className="button" href={`/exam/${exam.openAttemptId}`}>
              Continue the exam
            </Link>
          </p>
        ) : !overview.allModulesDone ? (
          <p className="muted">
            Finish all {modules.length} modules to unlock the exam.{next ? <> Next: <Link href={`/course/${assignment.id}/${next.key}`}>{next.title}</Link>.</> : null}
          </p>
        ) : exam.attempts.filter((a) => a.status === "submitted").length >= exam.triesAllowed ? (
          <p className="feedback bad">You have used all your tries. Please contact HR.</p>
        ) : exam.waitUntil ? (
          <p className="muted">
            Please review the topics you missed, then try again after {new Date(exam.waitUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. {exam.waitMinutes} minute{exam.waitMinutes === 1 ? "" : "s"} to go.
          </p>
        ) : (
          <StartExamButton assignmentId={assignment.id} label={exam.attempts.length ? "Try the exam again" : "Start the exam"} />
        )}
      </section>
    </>
  );
}
