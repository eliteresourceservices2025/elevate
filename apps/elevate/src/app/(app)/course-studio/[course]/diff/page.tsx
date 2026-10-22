import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { getStudioDiff } from "@/modules/learn/studio-queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "What changed" };

const num = (v: string | string[] | undefined) => {
  const n = Number(typeof v === "string" ? v : "");
  return Number.isInteger(n) && n > 0 ? n : 0;
};

export default async function StudioDiffPage({ params, searchParams }: PageProps<"/course-studio/[course]/diff">) {
  const { course } = await params;
  const q = await searchParams;
  const from = num(q.from);
  const to = num(q.to);
  if (!from || !to) notFound();
  const data = await orNotFound(getStudioDiff(course, from, to));
  if (!data) notFound();
  const { diff } = data;
  const list = (items: string[]) => (items.length ? <ul className="list-disc pl-5">{items.map((t, i) => <li key={i}>{t}</li>)}</ul> : null);

  return (
    <PageContainer width="wide">
      <PageHeader
        title={
          <>
            What changed from version {from} to version {to}
          </>
        }
        breadcrumbs={[{ label: "The versions", href: `/course-studio/${course}` }, { label: `What changed from version ${from} to version ${to}` }]}
      />
      {diff.unchanged ? <p className="rounded-xl border p-4 text-sm text-muted-foreground">Nothing is different between these two versions.</p> : null}

      <div className="space-y-5 text-sm">
        {diff.title ? <p>Title: &quot;{diff.title.from}&quot; became &quot;{diff.title.to}&quot;.</p> : null}
        {diff.attestation ? (
          <section>
            <h2 className="text-base font-semibold">Responsibility statement{diff.attestation.versionChanged ? " (new version label)" : ""}</h2>
            <p className="mt-1 text-muted-foreground">Before: {diff.attestation.from}</p>
            <p className="mt-1">After: {diff.attestation.to}</p>
          </section>
        ) : null}
        {diff.examConfig ? <p>The exam rules (pass mark, tries, questions per track or certificate length) changed.</p> : null}

        {diff.modules.added.length ? <section><h2 className="text-base font-semibold">Modules added</h2>{list(diff.modules.added)}</section> : null}
        {diff.modules.removed.length ? <section><h2 className="text-base font-semibold">Modules removed</h2>{list(diff.modules.removed)}</section> : null}
        {diff.modules.changed.map((m) => (
          <section key={m.key} className="rounded-lg border bg-card p-3">
            <h2 className="text-base font-semibold">Module: {m.title}</h2>
            {list(m.changes)}
            {m.screens.added.length ? <p className="mt-1">Screens added: {m.screens.added.join("; ")}</p> : null}
            {m.screens.removed.length ? <p className="mt-1">Screens removed: {m.screens.removed.join("; ")}</p> : null}
            {m.screens.changed.length ? <p className="mt-1">Screens reworded: {m.screens.changed.join("; ")}</p> : null}
          </section>
        ))}

        {diff.questions.added.length || diff.questions.removed.length || diff.questions.changed.length ? (
          <section>
            <h2 className="text-base font-semibold">Exam questions</h2>
            {diff.questions.added.length ? <p className="mt-1">{diff.questions.added.length} added.</p> : null}
            {diff.questions.removed.length ? <p className="mt-1">{diff.questions.removed.length} removed.</p> : null}
            {diff.questions.changed.length ? (
              <ul className="mt-1 list-disc pl-5">
                {diff.questions.changed.map((c, i) => (
                  <li key={i}>
                    {c.stem} <span className="text-muted-foreground">({c.what.join(", ")} changed)</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </PageContainer>
  );
}
