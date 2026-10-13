import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { ModuleMetaForm, ScreenEditor } from "@/modules/learn/components/studio-editors";
import { AddScreenForm } from "@/modules/learn/components/studio-structure";
import { BlockView } from "@/modules/learn/components/studio-view";
import { getStudioVersion } from "@/modules/learn/studio-queries";

export const metadata: Metadata = { title: "Course module" };

export default async function StudioModulePage({ params }: PageProps<"/course-studio/[course]/[version]/m/[moduleKey]">) {
  const { course, version, moduleKey } = await params;
  const data = await orNotFound(getStudioVersion(course, Number(version)));
  if (!data) notFound();
  const { loaded } = data;
  const m = loaded.content.modules.find((x) => x.key === moduleKey);
  if (!m) notFound();
  const draft = loaded.version.status === "draft";
  const stamp = loaded.version.editStamp;

  return (
    <div className="w-full max-w-4xl space-y-6">
      <p className="text-sm">
        <Link href={`/course-studio/${course}/${version}`} className="text-primary underline-offset-4 hover:underline">
          Back to version {version}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{m.title}</h1>
      <p className="text-sm text-muted-foreground">
        {draft ? "Editing a draft. Each screen and the module settings are saved separately." : "This version is frozen; this is a read-only view."}
      </p>

      {draft ? (
        <>
          <ModuleMetaForm key={`meta-${stamp}`} versionId={loaded.version.id} stamp={stamp} module={m} />
          <section aria-label="Screens" className="space-y-3">
            <h2 className="text-lg font-semibold">Screens</h2>
            {m.screens.map((s, i) => (
              <ScreenEditor key={`${s.id}-${stamp}`} versionId={loaded.version.id} stamp={stamp} moduleKey={m.key} screen={s} index={i} count={m.screens.length} />
            ))}
            <AddScreenForm key={`add-${stamp}`} versionId={loaded.version.id} stamp={stamp} moduleKey={m.key} />
          </section>
        </>
      ) : (
        <>
          <section className="rounded-xl border bg-card p-4 text-sm">
            <p>{m.summary}</p>
            <p className="mt-2 font-medium">Key points</p>
            <ul className="list-disc pl-5">{m.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
          </section>
          {m.screens.map((s, i) => (
            <section key={s.id} className="space-y-2 rounded-xl border bg-card p-4">
              <h2 className="text-base font-semibold">
                {i + 1}. {s.title}
              </h2>
              {s.blocks.map((b, j) => (
                <BlockView key={j} block={b} />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
