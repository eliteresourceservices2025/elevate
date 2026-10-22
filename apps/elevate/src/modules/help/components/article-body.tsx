import { Markdown } from "@/components/markdown";
import { splitBody } from "../body";

/** An article's text and pictures. Text goes through the app's safe Markdown renderer; pictures come from our own signed-in route. */
export function ArticleBody({ body }: { body: string }) {
  return (
    <div className="space-y-4">
      {splitBody(body).map((segment, i) =>
        segment.kind === "markdown" ? (
          <Markdown key={i} source={segment.text} maxLength={60_000} />
        ) : (
          <figure key={i} className="my-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot served by our own signed-in route */}
            <img src={`/api/help/assets/${segment.path}`} alt={segment.alt} loading="lazy" className="max-w-full rounded-lg border shadow-sm" />
            {segment.alt ? <figcaption className="mt-1 text-xs text-muted-foreground">{segment.alt}</figcaption> : null}
          </figure>
        ),
      )}
    </div>
  );
}
