import Link from "next/link";
import { notFound } from "next/navigation";
import { ExamRunner } from "@/components/exam-runner";
import { StartExamButton } from "@/components/forms";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getAttemptView, getOverview } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Exam" };

export const dynamic = "force-dynamic";

export default async function ExamPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const session = await requireSession();
  const view = await getAttemptView(getSql(), session.userId, attemptId);
  if (!view) notFound();

  if (view.status === "in_progress") {
    return <ExamRunner attemptId={view.id} items={view.items} deadlineAt={view.deadlineAt} serverNow={view.serverNow} />;
  }

  const result = view.result!;
  // a course with a mock call needs it passed too before the statement and the certificate
  const overview = await getOverview(getSql(), session.userId, view.assignmentId);
  // After the last try there is nothing to retry: say so instead of offering a button that only refuses.
  const outOfTries = !result.passed && Boolean(overview) && overview!.exam.attempts.filter((x) => x.status === "submitted").length >= overview!.exam.triesAllowed;
  // Only while the call itself is still to pass: a passed call with a record that has not caught up must not say "pass the mock call too".
  const callPending = Boolean(overview?.call) && overview?.assignment.status !== "passed" && !overview?.call?.attempts.some((x) => x.passed === true);
  const missed = view.review.filter((r) => !r.isCorrect);
  const modules = [...new Map(missed.map((r) => [r.moduleKey, r.moduleTitle])).entries()];

  return (
    <>
      <p className="muted">
        <Link href={`/course/${view.assignmentId}`}>Back to the course</Link>
      </p>
      <h1>{result.passed ? "You passed" : "Not yet"}</h1>
      <p className={`feedback ${result.passed ? "good" : "bad"}`}>
        You scored <strong>{result.scorePercent}%</strong> ({result.correct} of {view.total} correct). You need {view.tracks.passPercent}% to pass.
      </p>

      {result.passed ? (
        <>
          {callPending ? (
            <p className="feedback good">
              The exam is done. Pass the mock call too, to get your certificate. <Link href={`/course/${view.assignmentId}`}>Go to the course</Link>
            </p>
          ) : (
            <p>
              <Link className="button" href={`/certificate/${view.assignmentId}`}>
                Accept the statement and get your certificate
              </Link>
            </p>
          )}
          <h2>Review</h2>
          <ol className="plain">
            {view.review.map((r) => (
              <li key={r.position} className="card">
                <strong>{r.isCorrect ? "Correct" : "Missed"}</strong> · {r.moduleTitle} · {r.topic}
                {r.rationale ? <p className="muted">{r.rationale}</p> : null}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <h2>Topics to review</h2>
          <p>{outOfTries ? "These are the modules where you missed questions." : "These are the modules where you missed questions. Open them again, then try the exam once more."}</p>
          <ul>
            {modules.map(([key, title]) => (
              <li key={key}>
                <Link href={`/course/${view.assignmentId}/${key}`}>{title}</Link>
              </li>
            ))}
          </ul>
          {outOfTries ? (
            <p className="feedback bad" role="status">
              You have used all your tries. Please contact HR: they can give you more.
            </p>
          ) : (
            <StartExamButton assignmentId={view.assignmentId} label="Try the exam again" />
          )}
        </>
      )}
    </>
  );
}
