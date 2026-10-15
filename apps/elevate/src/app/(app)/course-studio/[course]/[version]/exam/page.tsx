import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { sampleExam } from "@/modules/learn/studio-exam-preview";
import { getStudioVersion } from "@/modules/learn/studio-queries";

export const metadata: Metadata = { title: "Exam preview" };

type Cfg = { passPercent?: number; maxTries?: number; waitMinutesAfterFail?: number; tracks?: Record<string, { questions: number; minutes?: number }> };

/** A sample exam for one track of a version, drawn the way the real exam is, with the key shown. Nothing is recorded. */
export default async function StudioExamPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ course: string; version: string }>;
  searchParams: Promise<{ track?: string; seed?: string }>;
}) {
  const { course, version } = await params;
  const query = await searchParams;
  const data = await orNotFound(getStudioVersion(course, Number(version)));
  if (!data) notFound();
  const { loaded } = data;
  const cfg = loaded.examConfig as Cfg;
  const tracks = Object.keys(cfg.tracks ?? {});
  const track = query.track && tracks.includes(query.track) ? query.track : tracks[0];
  const seed = Number.isInteger(Number(query.seed)) && Number(query.seed) >= 0 ? Number(query.seed) : 1;
  const base = `/course-studio/${course}/${version}`;

  const count = track ? (cfg.tracks?.[track]?.questions ?? 0) : 0;
  const keys = track ? loaded.content.modules.filter((m) => (m.tracks as string[]).includes(track)).map((m) => m.key) : [];
  const sample = sampleExam(loaded.questions.map((q) => ({ id: q.id, moduleKey: q.moduleKey, topic: q.topic, stem: q.stem, options: q.options, correctIds: q.correctIds, type: q.type })), keys, count, seed);
  const titles = new Map(loaded.content.modules.map((m) => [m.key, m.title]));

  return (
    <div className="w-full max-w-6xl space-y-6">
      <p className="text-sm">
        <Link href={base} className="text-primary underline-offset-4 hover:underline">
          Back to version {version}
        </Link>
      </p>
      <div>
        <h1 className="text-2xl font-bold">Exam preview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A sample of what one learner would get on the {track ?? "chosen"} track. Questions are drawn across the track&apos;s modules and shown in a random order with the options
          shuffled, as in the real exam. The key is shown here for editors only. Nothing is recorded, and a learner&apos;s exam will differ.
        </p>
      </div>

      <section className="space-y-2 rounded-xl border bg-card p-4 text-sm" aria-label="Exam rules">
        <p>
          <strong>{count}</strong> questions · pass mark <strong>{cfg.passPercent ?? 85}%</strong> · <strong>{cfg.maxTries ?? 3}</strong> tries · wait {cfg.waitMinutesAfterFail ?? 60} minutes after a
          miss · {cfg.tracks?.[track ?? ""]?.minutes ? `${cfg.tracks[track!].minutes} minutes` : "no time limit"}
        </p>
        <p className="text-muted-foreground">
          Available for this track:{" "}
          {Object.entries(sample.pool)
            .map(([k, n]) => `${titles.get(k) ?? k} ${n}`)
            .join(" · ") || "none"}
        </p>
        {sample.short ? <p className="font-medium text-destructive">This track has fewer questions than the exam asks for, so the exam would not start. Add questions first.</p> : null}
        <p className="flex flex-wrap items-center gap-3">
          {tracks.map((t) => (
            <Link key={t} href={`${base}/exam?track=${t}&seed=${seed}`} className={`rounded-md border px-2 py-1 ${t === track ? "bg-primary text-primary-foreground" : ""}`}>
              {t}
            </Link>
          ))}
          <Link href={`${base}/exam?track=${track ?? ""}&seed=${seed + 1}`} className="text-primary underline-offset-4 hover:underline">
            Draw another sample
          </Link>
        </p>
      </section>

      <ol className="space-y-3">
        {sample.questions.map((q, i) => (
          <li key={q.id} className="rounded-xl border bg-card p-4 text-sm">
            <p className="text-xs text-muted-foreground">
              {titles.get(q.moduleKey) ?? q.moduleKey} · {q.topic} · {q.type.replace("_", "/")}
            </p>
            <p className="font-medium">
              {i + 1}. {q.stem}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {q.shuffledOptions.map((o) => (
                <li key={o.id}>
                  {q.correctIds.includes(o.id) ? <strong>(key) </strong> : null}
                  {o.text}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
