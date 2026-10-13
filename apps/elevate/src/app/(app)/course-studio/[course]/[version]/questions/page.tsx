import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { QuestionEditor } from "@/modules/learn/components/studio-editors";
import { getStudioVersion } from "@/modules/learn/studio-queries";

export const metadata: Metadata = { title: "Exam question bank" };

export default async function StudioQuestionsPage({ params }: PageProps<"/course-studio/[course]/[version]/questions">) {
  const { course, version } = await params;
  const data = await orNotFound(getStudioVersion(course, Number(version)));
  if (!data) notFound();
  const { loaded } = data;
  const draft = loaded.version.status === "draft";

  return (
    <div className="w-full max-w-4xl space-y-6">
      <p className="text-sm">
        <Link href={`/course-studio/${course}/${version}`} className="text-primary underline-offset-4 hover:underline">
          Back to version {version}
        </Link>
      </p>
      <div>
        <h1 className="text-2xl font-bold">Exam question bank</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loaded.questions.length} questions. The answer key and the reasons are shown here for editors only: they are never sent to learners except the reason after a pass.
          {draft ? "" : " This version is frozen; this is a read-only view."}
        </p>
      </div>
      {loaded.content.modules.map((m) => {
        const list = loaded.questions.filter((q) => q.moduleKey === m.key);
        if (list.length === 0) return null;
        return (
          <section key={m.key} className="space-y-2">
            <h2 className="text-lg font-semibold">
              {m.title} ({list.length})
            </h2>
            {list.map((q) => {
              const n = loaded.questions.indexOf(q) + 1;
              return draft ? (
                <QuestionEditor key={`${q.id}-${loaded.version.editStamp}`} versionId={loaded.version.id} stamp={loaded.version.editStamp} question={q} number={n} />
              ) : (
                <div key={q.id} className="rounded-xl border bg-card p-4 text-sm">
                  <p className="font-medium">
                    Q{n}. {q.stem}
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {q.options.map((o) => (
                      <li key={o.id}>
                        {q.correctIds.includes(o.id) ? <strong>(correct) </strong> : null}
                        {o.text}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted-foreground">Reason: {q.rationale}</p>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
