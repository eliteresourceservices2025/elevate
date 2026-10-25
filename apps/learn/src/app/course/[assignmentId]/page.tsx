import Link from "next/link";
import { notFound } from "next/navigation";
import { VideoButton, VideoGroup } from "@/components/recap-panel";
import { demoVideos, welcomeVideo } from "@/content/customer-service/videos";
import { CallCard } from "@/components/call-card";
import { ModuleCard } from "@/components/module-card";
import { StartExamButton } from "@/components/forms";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getOverview } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Course" };

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
  const welcome = welcomeVideo(assignment.courseSlug);

  return (
    <>
      <div className="course-wide">
        <p className="muted">
          <Link href="/">My training</Link>
        </p>
        <div className="course-head">
          <div>
            <h1>{assignment.isUpdate ? `${assignment.courseTitle}: update` : assignment.courseTitle}</h1>
            {assignment.isUpdate ? <p>Some lessons changed since you were certified. Read the ones below, then answer a few questions. Your certificate stays valid.</p> : null}
            {finished ? (
              <p className="feedback good">
                You passed this course. {certificate ? <Link href={`/certificate/${assignment.id}`}>View my certificate</Link> : null}
              </p>
            ) : (
              <p className="muted">Due {assignment.dueOn}</p>
            )}
            {welcome ? (
              <div className="video-bar">
                <VideoButton recap={welcome} title={assignment.courseTitle} className="video-btn video-btn-primary">
                  Watch welcome video
                </VideoButton>
              </div>
            ) : null}
          </div>
          <div className="course-progress" role="group" aria-label="Your progress">
            <span className="muted small">
              {finished && doneCount < modules.length ? "Course completed. Lesson progress from before is not shown." : `${doneCount} of ${modules.length} modules done`}
            </span>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={modules.length} aria-valuenow={doneCount}>
              <div style={{ width: `${modules.length ? (doneCount / modules.length) * 100 : 0}%` }} />
            </div>
          </div>
        </div>

        <ol className="mod-grid" aria-label="Modules">
          {modules.map((m, i) => (
            <ModuleCard
              key={m.key}
              index={i + 1}
              title={m.title}
              summary={m.summary}
              minutes={m.estimatedMinutes}
              status={m.completed ? "done" : m.locked ? "locked" : m.seconds > 0 ? "progress" : "new"}
              href={!m.locked || finished ? `/course/${assignment.id}/${m.key}` : null}
              course={assignment.courseSlug}
              moduleKey={m.key}
            />
          ))}
        </ol>
      </div>

      <div className="course-narrow">
      {!overview.requiresExam ? (
        <section className="card" aria-labelledby="ack-h">
          <h2 id="ack-h">Acknowledgment</h2>
          {certificate ? (
            <p>
              <Link className="button" href={`/certificate/${assignment.id}`}>
                View my certificate
              </Link>
            </p>
          ) : overview.allModulesDone ? (
            <>
              <p>There is no exam for this course. Read the statement and accept it to finish.</p>
              <p>
                <Link className="button" href={`/certificate/${assignment.id}`}>
                  Accept and get my certificate
                </Link>
              </p>
            </>
          ) : (
            <p className="muted">
              Finish all {modules.length} modules to unlock the statement.{next ? <> Next: <Link href={`/course/${assignment.id}/${next.key}`}>{next.title}</Link>.</> : null}
            </p>
          )}
        </section>
      ) : (
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
        ) : exam.attempts.some((a) => a.passed) ? (
          <p className="feedback good">{overview.call ? "You passed the exam. Pass the mock call too, to get your certificate." : "You passed the exam."}</p>
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
      )}
      {overview.call && demoVideos(assignment.courseSlug).length ? <VideoGroup videos={demoVideos(assignment.courseSlug)} title="Worked example calls" heading="Optional: watch three worked example calls before the mock call" /> : null}
      {overview.call ? <CallCard assignmentId={assignment.id} call={overview.call} allModulesDone={overview.allModulesDone} finished={finished} /> : null}
      </div>
    </>
  );
}
