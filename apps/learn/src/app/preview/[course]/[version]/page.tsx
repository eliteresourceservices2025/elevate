import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getPreview } from "@/lib/preview";

export const dynamic = "force-dynamic";

/** A course version as a learner sees it, for editors. Nothing is recorded. */
export default async function PreviewPage({ params }: { params: Promise<{ course: string; version: string }> }) {
  const { course, version } = await params;
  const session = await requireSession();
  const preview = await getPreview(getSql(), session.userId, course, Number(version));
  if (!preview) notFound();

  return (
    <>
      <p className="card" role="note">
        <strong>Preview of version {preview.version}</strong> ({preview.status}). This is how the lessons read for a learner. Nothing you do here is recorded, and there is
        no timing or exam.
      </p>
      <h1>{preview.content.title}</h1>
      <ol className="plain">
        {preview.content.modules.map((m, i) => (
          <li key={m.key} className="card">
            <strong>
              {i + 1}. {m.title}
            </strong>
            <div className="muted">
              {m.estimatedMinutes} minutes · {m.screens.length} screens · {m.tracks.join(", ")}
            </div>
            <p className="muted">{m.summary}</p>
            <p>
              <Link className="button secondary" href={`/preview/${course}/${preview.version}/${m.key}`}>
                Read this module
              </Link>
            </p>
          </li>
        ))}
      </ol>
    </>
  );
}
