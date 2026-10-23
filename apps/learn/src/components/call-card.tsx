import Link from "next/link";
import type { CallOverview } from "@/lib/queries";
import { StartCallButton } from "./forms";

/** The mock call on the course page, next to the exam. The server decides everything; this only shows where the person stands. */
export function CallCard({ assignmentId, call, allModulesDone, finished }: { assignmentId: string; call: CallOverview; allModulesDone: boolean; finished: boolean }) {
  const submitted = call.attempts.filter((a) => a.status === "submitted");
  const passed = call.attempts.some((a) => a.passed === true) || finished;
  return (
    <section className="card" aria-labelledby="call-h">
      <h2 id="call-h">Mock call</h2>
      <p>{`${call.scenarios} calls · ${call.passPercent}% to pass · ${call.triesAllowed} tries · no time limit`}</p>
      <p className="muted">Practise real calls on screen: read or listen to the caller and pick your replies. Your certificate needs both the exam and the mock call.</p>
      {submitted.length > 0 ? (
        <ul>
          {submitted.map((a) => (
            <li key={a.id}>
              {`Try ${a.attemptNo}: ${a.scorePercent}% ${a.passed ? "(passed)" : "(not yet)"} · `}
              <Link href={`/call/${a.id}`}>see the result</Link>
            </li>
          ))}
        </ul>
      ) : null}
      {passed ? (
        <p className="feedback good">You passed the mock call.</p>
      ) : call.openAttemptId ? (
        <p>
          <Link className="button" href={`/call/${call.openAttemptId}`}>
            Continue the mock call
          </Link>
        </p>
      ) : !allModulesDone ? (
        <p className="muted">Finish all the modules to unlock the mock call.</p>
      ) : submitted.length >= call.triesAllowed ? (
        <p className="feedback bad">You have used all your tries. Please contact HR.</p>
      ) : call.waitUntil ? (
        <p className="muted">
          {`Please practise the skills you lost points on, then try again after ${new Date(call.waitUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. ${call.waitMinutes} minute${call.waitMinutes === 1 ? "" : "s"} to go.`}
        </p>
      ) : (
        <StartCallButton assignmentId={assignmentId} label={submitted.length ? "Try the mock call again" : "Start the mock call"} />
      )}
    </section>
  );
}
