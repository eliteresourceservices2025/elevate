import { Badge } from "@/components/ui/badge";
import { formatInZone } from "@/lib/time";
import { bandOf } from "../keywords";

/** The keyword match for one application: the percentage, the words found and the words missing, and what it is (and is not). */
export function KeywordPanel({ keyword }: { keyword: { configured: boolean; score: number | null; matched: string[]; missed: string[]; scoredAt: Date | null; stale: boolean } }) {
  if (!keyword.configured && keyword.scoredAt === null) return null;
  return (
    <section aria-label="Keyword match" className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Keyword match</h2>
        {keyword.score !== null ? <Badge variant={keyword.score >= 75 ? "default" : "outline"}>{keyword.score}% · {bandOf(keyword.score)}</Badge> : null}
        {keyword.stale ? <Badge variant="secondary">Keywords changed since</Badge> : null}
      </div>
      {keyword.score === null ? (
        <p className="text-sm text-muted-foreground">{keyword.scoredAt ? "No score: the resume has no readable text (it may be a scan or a damaged file)." : "Not scored yet."}</p>
      ) : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Found in the resume</dt>
            <dd className="mt-1 flex flex-wrap gap-1">{keyword.matched.length === 0 ? "None" : keyword.matched.map((k) => <Badge key={k} variant="secondary">{k}</Badge>)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Not found</dt>
            <dd className="mt-1 flex flex-wrap gap-1">{keyword.missed.length === 0 ? "None" : keyword.missed.map((k) => <Badge key={k} variant="outline">{k}</Badge>)}</dd>
          </div>
        </dl>
      )}
      <p className="text-xs text-muted-foreground">
        A reading aid only: it counts the words recruiters listed for this job, nothing about the person, and people decide. The resume text is not kept.
        {keyword.scoredAt ? ` Scored ${formatInZone(keyword.scoredAt, undefined, "MMM d, yyyy")}.` : ""}
      </p>
    </section>
  );
}
