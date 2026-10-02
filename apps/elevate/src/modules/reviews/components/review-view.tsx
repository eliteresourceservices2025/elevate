import { RATING_LABELS, type Answers, type Question } from "../constants";

type Response = { answers: Answers; overallRating: number | null; comments: string | null; submittedAt: Date };

/** A submitted review, read-only: each question with its rating or text. */
export function ReviewAnswers({ title, response, questions }: { title: string; response: Response; questions: Question[] }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <dl className="space-y-3">
        {questions.map((q) => {
          const a = response.answers[q.id];
          if (!a || (a.rating === undefined && !a.text)) return null;
          return (
            <div key={q.id}>
              <dt className="text-sm text-muted-foreground">{q.prompt}</dt>
              <dd className="whitespace-pre-wrap text-sm">{a.rating !== undefined ? `${a.rating}: ${RATING_LABELS[a.rating]}` : a.text}</dd>
            </div>
          );
        })}
      </dl>
      {response.overallRating ? (
        <p className="text-sm">
          <strong>Overall:</strong> {response.overallRating}: {RATING_LABELS[response.overallRating]}
        </p>
      ) : null}
      {response.comments ? <p className="whitespace-pre-wrap text-sm"><strong>Comments:</strong> {response.comments}</p> : null}
    </section>
  );
}
