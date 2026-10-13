import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentBlocks } from "@/components/content-blocks";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getPreview } from "@/lib/preview";

export const dynamic = "force-dynamic";

/** One module of a version, every screen in order, with the checks and scenarios working. Nothing is recorded. */
export default async function PreviewModulePage({ params }: { params: Promise<{ course: string; version: string; moduleKey: string }> }) {
  const { course, version, moduleKey } = await params;
  const session = await requireSession();
  const preview = await getPreview(getSql(), session.userId, course, Number(version));
  if (!preview) notFound();
  const m = preview.content.modules.find((x) => x.key === moduleKey);
  if (!m) notFound();

  return (
    <>
      <p className="muted">
        <Link href={`/preview/${course}/${preview.version}`}>Back to the preview of version {preview.version}</Link>
      </p>
      <p className="card" role="note">
        Preview (nothing is recorded).
      </p>
      <h1>{m.title}</h1>
      <p className="muted">{m.summary}</p>
      {m.screens.map((s, i) => (
        <section key={s.id} aria-label={s.title}>
          <h2>
            {i + 1}. {s.title}
          </h2>
          <ContentBlocks blocks={s.blocks} />
        </section>
      ))}
      <h2>Key points</h2>
      <ul>
        {m.keyPoints.map((k, i) => (
          <li key={i}>{k}</li>
        ))}
      </ul>
    </>
  );
}
