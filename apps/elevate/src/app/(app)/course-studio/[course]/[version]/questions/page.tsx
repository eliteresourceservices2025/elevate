import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { QuestionEditor } from "@/modules/learn/components/studio-editors";
import { AddQuestionForm } from "@/modules/learn/components/studio-structure";
import { getStudioVersion } from "@/modules/learn/studio-queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Exam question bank" };

export default async function StudioQuestionsPage({ params }: PageProps<"/course-studio/[course]/[version]/questions">) {
  const { course, version } = await params;
  const data = await orNotFound(getStudioVersion(course, Number(version)));
  if (!data) notFound();
  const { loaded } = data;
  const draft = loaded.version.status === "draft";

  return (
    <PageContainer width="wide">
      <p className="text-sm">
        <Link href={`/course-studio/${course}/${version}`} className="text-primary underline-offset-4 hover:underline">
          Back to version {version}
        </Link>
      </p>
      <PageHeader
        title="Exam question bank"
        description={
          <>
            {loaded.questions.length} questions. The answer key and the reasons are shown here for editors only: they are never sent to learners
            except the reason after a pass.
            {draft ? "" : " This version is frozen; this is a read-only view."}
          </>
        }
      />
      {loaded.content.modules.map((m) => {
        const list = loaded.questions.filter((q) => q.moduleKey === m.key);
        if (list.length === 0 && !draft) return null;
        return (
          <section key={m.key} className="space-y-2">
            <h2 className="text-lg font-semibold">
              {m.title} ({list.length})
            </h2>
            {list.map((q) => {
              const n = loaded.questions.indexOf(q) + 1;
              return draft ? (
                <QuestionEditor key={`${q.id}-${loaded.version.editStamp}`} versionId={loaded.version.id} stamp={loaded.version.editStamp} question={q} number={n} modules={loaded.content.modules.map((m) => ({ key: m.key, title: m.title }))} />
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
            {draft ? <AddQuestionForm key={`add-${loaded.version.editStamp}`} versionId={loaded.version.id} stamp={loaded.version.editStamp} moduleKey={m.key} /> : null}
          </section>
        );
      })}
    </PageContainer>
  );
}
