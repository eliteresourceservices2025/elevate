import Link from "next/link";
import type { CallView } from "@/lib/queries";
import { StartCallButton } from "./forms";

export const CATEGORY_LABELS: Record<string, string> = {
  opening: "Opening and tone",
  listening: "Listening and empathy",
  accuracy: "Accuracy and confidentiality",
  resolution: "Resolution and next steps",
  deescalation: "De-escalation",
  documentation: "Documentation",
};

/**
 * The result of a submitted mock call: the score, the pass mark and a percentage for each of the six skills. After a PASSED attempt
 * the review shows every step with what was picked, the best reply and why; after a failed one there is no review, only the skills
 * to work on (the server sends nothing more).
 */
export function CallResult({ view }: { view: CallView }) {
  const result = view.result;
  if (!result) return null;
  const rows = Object.entries(result.categories);
  const stepOf = (scenarioId: string, stepId: string) => view.scenarios.find((s) => s.id === scenarioId)?.steps.find((s) => s.id === stepId);

  return (
    <>
      <h1>{result.passed ? "You passed the mock call" : "Not yet"}</h1>
      <p className={`feedback ${result.passed ? "good" : "bad"}`}>
        {`You scored `}
        <strong>{`${result.scorePercent}%`}</strong>
        {`. You need ${view.config.passPercent}% to pass.`}
      </p>

      <h2>Your skills in this call</h2>
      <ul className="plain skills">
        {rows.map(([key, percent]) => (
          <li key={key}>
            <span>{CATEGORY_LABELS[key] ?? key}</span>
            <div className="progress" role="img" aria-label={`${CATEGORY_LABELS[key] ?? key}: ${percent}%`}>
              <div style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
            </div>
            <strong>{`${percent}%`}</strong>
          </li>
        ))}
      </ul>

      {result.passed ? (
        <>
          <p>
            <Link className="button" href={`/course/${view.assignmentId}`}>
              Back to the course
            </Link>
          </p>
          <h2>Review</h2>
          <ol className="plain">
            {view.review.map((r) => {
              const step = stepOf(r.scenarioId, r.stepId);
              const text = (id: string) => step?.choices.find((c) => c.id === id)?.text ?? id;
              return (
                <li key={`${r.scenarioId}-${r.stepId}`} className="card">
                  <p className="muted">{step?.text}</p>
                  <p>
                    <strong>You chose: </strong>
                    {text(r.chosen)} <span className="muted">{`(${r.points} of ${r.maxPoints})`}</span>
                  </p>
                  {r.chosen !== r.best ? (
                    <p>
                      <strong>Best reply: </strong>
                      {text(r.best)}
                    </p>
                  ) : null}
                  <p className="muted">{r.why}</p>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <>
          <p>These are the skills to practise. Open the modules again, then try the mock call once more.</p>
          <p>
            <Link href={`/course/${view.assignmentId}`}>Back to the course</Link>
          </p>
          <StartCallButton assignmentId={view.assignmentId} label="Try the mock call again" />
        </>
      )}
    </>
  );
}
