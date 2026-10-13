"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useWarnWhenEdited } from "@/components/unsaved-changes";
import type { Block, CourseContent, CourseModule, QuestionSeed } from "../../../../../learn/src/content/schema";
import { createStudioDraft, discardStudioDraft, publishStudioDraft, saveStudioCourseMeta, saveStudioModuleMeta, saveStudioQuestion, saveStudioScreen } from "../studio-actions";
import { newBlock } from "../studio-scaffold";
import { RemoveQuestionButton, ScreenControls } from "./studio-structure";

type Saved = { ok: true } | { ok: false; error: string };

/** Runs a save, shows the result, and refreshes the page so every form gets the new stamp. */
function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok = "Saved.", after?: () => void) =>
    start(async () => {
      try {
        const r = (await fn()) as Saved;
        if (!r.ok) return void toast.error(r.error);
        toast.success(ok);
        after?.();
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return { run, pending, router };
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---- Draft actions ------------------------------------------------------------------------------------------------------------

export function NewDraftForm({ course, fromVersion }: { course: string; fromVersion?: number }) {
  const { run, pending, router } = useSave();
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          async () => {
            const r = await createStudioDraft({ course, fromVersion, note });
            if (r.ok) router.push(`/course-studio/${course}/${r.data.version}`);
            return r;
          },
          "Draft created.",
        );
      }}
    >
      <div className="min-w-72 flex-1">
        <Field id={`note-${fromVersion ?? "latest"}`} label={fromVersion ? `New draft from version ${fromVersion}: what is it for?` : "New draft from the latest version: what is it for?"}>
          <Input id={`note-${fromVersion ?? "latest"}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required placeholder="For example: update the incident deadlines after counsel's review" />
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={pending || note.trim().length < 3}>
        Start a draft
      </Button>
    </form>
  );
}

export function DiscardDraftButton({ versionId, stamp, course }: { versionId: string; stamp: number; course: string }) {
  const { run, pending, router } = useSave();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Discard this draft? Its edits are deleted and cannot be brought back.")) return;
        run(
          async () => {
            const r = await discardStudioDraft({ versionId, stamp });
            if (r.ok) router.push(`/course-studio/${course}`);
            return r;
          },
          "Draft discarded.",
        );
      }}
    >
      Discard the draft
    </Button>
  );
}

export function PublishCard({ versionId, canPublish, blocked }: { versionId: string; canPublish: boolean; blocked: string | null }) {
  const { run, pending, router } = useSave();
  const [reviewer, setReviewer] = useState("");
  const [date, setDate] = useState("");
  const [material, setMaterial] = useState(false);
  return (
    <section aria-label="Publish" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Publish this draft</h2>
      {blocked ? <p className="text-sm text-muted-foreground">{blocked}</p> : null}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!window.confirm("Publish now? A published version is frozen. People already on the old version finish it.")) return;
          run(
            async () => {
              const r = await publishStudioDraft({ versionId, reviewerEmail: reviewer, counselApprovedOn: date, material });
              if (r.ok) router.push("/course-studio");
              return r;
            },
            "Published.",
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pub-reviewer" label="Who reviewed it (sign-in email)">
            <Input id="pub-reviewer" type="email" value={reviewer} onChange={(e) => setReviewer(e.target.value)} required disabled={!canPublish} />
          </Field>
          <Field id="pub-date" label="Date counsel approved the text">
            <Input id="pub-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={!canPublish} />
          </Field>
        </div>
        <label htmlFor="pub-material" className="flex items-start gap-2 text-sm">
          <input id="pub-material" type="checkbox" className="mt-0.5 size-4 accent-primary" checked={material} onChange={(e) => setMaterial(e.target.checked)} disabled={!canPublish} />
          <span>This is a material change (people who are already trained would need to relearn it).</span>
        </label>
        <Button type="submit" disabled={pending || !canPublish || !reviewer || !date}>
          {pending ? "Publishing..." : "Publish"}
        </Button>
      </form>
    </section>
  );
}

// ---- Course and module settings -------------------------------------------------------------------------------------------------

export function CourseMetaForm({ versionId, stamp, content }: { versionId: string; stamp: number; content: CourseContent }) {
  const { run, pending } = useSave();
  const [title, setTitle] = useState(content.title);
  const [aVersion, setAVersion] = useState(content.attestation.version);
  const [aText, setAText] = useState(content.attestation.text);
  const { markSaved } = useWarnWhenEdited({ title, aVersion, aText });
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveStudioCourseMeta({ versionId, stamp, title, attestationVersion: aVersion, attestationText: aText }), "Saved.", markSaved);
      }}
    >
      <h2 className="text-lg font-semibold">Course title and responsibility statement</h2>
      <Field id="cm-title" label="Course title">
        <Input id="cm-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
      </Field>
      <Field id="cm-text" label="Statement people accept after passing" hint="Counsel approves the wording. Change the version label when the text changes.">
        <Textarea id="cm-text" rows={5} value={aText} onChange={(e) => setAText(e.target.value)} maxLength={1500} required />
      </Field>
      <Field id="cm-ver" label="Statement version label">
        <Input id="cm-ver" value={aVersion} onChange={(e) => setAVersion(e.target.value)} maxLength={30} required className="w-48" />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

const TRACKS = ["full", "essentials", "refresher"] as const;

export function ModuleMetaForm({ versionId, stamp, module }: { versionId: string; stamp: number; module: CourseModule }) {
  const { run, pending } = useSave();
  const [title, setTitle] = useState(module.title);
  const [summary, setSummary] = useState(module.summary);
  const [minutes, setMinutes] = useState(module.estimatedMinutes);
  const [tracks, setTracks] = useState<string[]>(module.tracks);
  const [points, setPoints] = useState(module.keyPoints.join("\n"));
  const { markSaved } = useWarnWhenEdited({ title, summary, minutes, tracks, points });
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveStudioModuleMeta({ versionId, stamp, moduleKey: module.key, title, summary, estimatedMinutes: minutes, tracks, keyPoints: lines(points) }),
          "Saved.",
          markSaved,
        );
      }}
    >
      <h2 className="text-lg font-semibold">Module settings</h2>
      <Field id="mm-title" label="Title">
        <Input id="mm-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
      </Field>
      <Field id="mm-summary" label="Summary">
        <Textarea id="mm-summary" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={300} required />
      </Field>
      <div className="flex flex-wrap items-end gap-4">
        <Field id="mm-min" label="Estimated minutes" hint="The minimum reading time is a share of this.">
          <Input id="mm-min" type="number" min={1} max={120} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-28" />
        </Field>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Tracks that include it</legend>
          <div className="flex gap-3">
            {TRACKS.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={tracks.includes(t)} onChange={(e) => setTracks((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))} />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <Field id="mm-points" label="Key points (one per line, 3 to 8)">
        <Textarea id="mm-points" rows={6} value={points} onChange={(e) => setPoints(e.target.value)} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

// ---- Screens and blocks -------------------------------------------------------------------------------------------------------

function BlockEditor({ block, onChange, idp }: { block: Block; onChange: (b: Block) => void; idp: string }) {
  switch (block.type) {
    case "paragraph":
      return (
        <Field id={idp} label="Paragraph">
          <Textarea id={idp} rows={4} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} maxLength={900} />
        </Field>
      );
    case "list":
      return (
        <Field id={idp} label={`List (one item per line${block.ordered ? ", numbered" : ""})`}>
          <Textarea id={idp} rows={Math.max(3, block.items.length + 1)} value={block.items.join("\n")} onChange={(e) => onChange({ ...block, items: lines(e.target.value) })} />
        </Field>
      );
    case "callout":
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            <Field id={`${idp}-tone`} label="Callout style">
              <NativeSelect id={`${idp}-tone`} value={block.tone} onChange={(e) => onChange({ ...block, tone: e.target.value as typeof block.tone })} className="w-32">
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="tip">tip</option>
              </NativeSelect>
            </Field>
            <div className="min-w-60 flex-1">
              <Field id={`${idp}-title`} label="Callout title (optional)">
                <Input id={`${idp}-title`} value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value || undefined })} maxLength={160} />
              </Field>
            </div>
          </div>
          <Field id={idp} label="Callout text">
            <Textarea id={idp} rows={3} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} maxLength={900} />
          </Field>
        </div>
      );
    case "compare":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["left", "right"] as const).map((side) => (
            <div key={side} className="space-y-2 rounded-lg border p-2">
              <Field id={`${idp}-${side}-t`} label={`${side === "left" ? "Left" : "Right"} column title`}>
                <Input id={`${idp}-${side}-t`} value={block[side].title} onChange={(e) => onChange({ ...block, [side]: { ...block[side], title: e.target.value } })} maxLength={160} />
              </Field>
              <Field id={`${idp}-${side}-i`} label="Items (one per line)">
                <Textarea id={`${idp}-${side}-i`} rows={4} value={block[side].items.join("\n")} onChange={(e) => onChange({ ...block, [side]: { ...block[side], items: lines(e.target.value) } })} />
              </Field>
            </div>
          ))}
        </div>
      );
    case "steps":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium">Steps</p>
          {block.items.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-2">
              <Field id={`${idp}-${i}-t`} label={`Step ${i + 1} title`}>
                <Input id={`${idp}-${i}-t`} value={s.title} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} maxLength={160} />
              </Field>
              <Field id={`${idp}-${i}-x`} label="What to do">
                <Input id={`${idp}-${i}-x`} value={s.text} onChange={(e) => onChange({ ...block, items: block.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} maxLength={160} />
              </Field>
            </div>
          ))}
        </div>
      );
    case "scenario":
      return (
        <div className="space-y-2">
          <Field id={`${idp}-t`} label="Scenario title">
            <Input id={`${idp}-t`} value={block.title} onChange={(e) => onChange({ ...block, title: e.target.value })} maxLength={160} />
          </Field>
          <Field id={idp} label="What happens">
            <Textarea id={idp} rows={3} value={block.prompt} onChange={(e) => onChange({ ...block, prompt: e.target.value })} maxLength={900} />
          </Field>
          {block.choices.map((c, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-2">
              <Field id={`${idp}-c${i}-t`} label={`Choice ${i + 1}`}>
                <Input id={`${idp}-c${i}-t`} value={c.text} onChange={(e) => onChange({ ...block, choices: block.choices.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} maxLength={160} />
              </Field>
              <Field id={`${idp}-c${i}-f`} label="Feedback shown after choosing it">
                <Textarea id={`${idp}-c${i}-f`} rows={2} value={c.feedback} onChange={(e) => onChange({ ...block, choices: block.choices.map((x, j) => (j === i ? { ...x, feedback: e.target.value } : x)) })} maxLength={500} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={c.best} onChange={(e) => onChange({ ...block, choices: block.choices.map((x, j) => (j === i ? { ...x, best: e.target.checked } : x)) })} />
                This is the best choice
              </label>
            </div>
          ))}
        </div>
      );
    case "check":
      return (
        <div className="space-y-2">
          <Field id={idp} label="Knowledge check question">
            <Input id={idp} value={block.question} onChange={(e) => onChange({ ...block, question: e.target.value })} maxLength={160} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={Boolean(block.multiple)} onChange={(e) => onChange({ ...block, multiple: e.target.checked || undefined })} />
            More than one answer is correct
          </label>
          {block.options.map((o, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-2">
              <Field id={`${idp}-o${i}-t`} label={`Option ${i + 1}`}>
                <Input id={`${idp}-o${i}-t`} value={o.text} onChange={(e) => onChange({ ...block, options: block.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} maxLength={160} />
              </Field>
              <Field id={`${idp}-o${i}-f`} label="Feedback">
                <Input id={`${idp}-o${i}-f`} value={o.feedback} onChange={(e) => onChange({ ...block, options: block.options.map((x, j) => (j === i ? { ...x, feedback: e.target.value } : x)) })} maxLength={400} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={o.correct} onChange={(e) => onChange({ ...block, options: block.options.map((x, j) => (j === i ? { ...x, correct: e.target.checked } : x)) })} />
                Correct
              </label>
            </div>
          ))}
        </div>
      );
  }
}

const BLOCK_TYPES: { value: Block["type"]; label: string }[] = [
  { value: "paragraph", label: "Paragraph" },
  { value: "list", label: "List" },
  { value: "callout", label: "Callout" },
  { value: "compare", label: "Do and do not" },
  { value: "steps", label: "Steps" },
  { value: "scenario", label: "Scenario" },
  { value: "check", label: "Knowledge check" },
];

export function ScreenEditor({ versionId, stamp, moduleKey, screen, index, count }: { versionId: string; stamp: number; moduleKey: string; screen: CourseModule["screens"][number]; index: number; count: number }) {
  const { run, pending } = useSave();
  const [addType, setAddType] = useState<Block["type"]>("paragraph");
  const [title, setTitle] = useState(screen.title);
  const [blocks, setBlocks] = useState<Block[]>(screen.blocks);
  const { markSaved } = useWarnWhenEdited({ title, blocks });
  return (
    <details className="rounded-xl border bg-card p-4" open={index === 0}>
      <summary className="cursor-pointer text-base font-semibold">
        {index + 1}. {screen.title}
      </summary>
      <form
        className="mt-3 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveStudioScreen({ versionId, stamp, moduleKey, screenId: screen.id, title, blocks }), "Saved.", markSaved);
        }}
      >
        <Field id={`s-${screen.id}-title`} label="Screen title">
          <Input id={`s-${screen.id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
        </Field>
        {blocks.map((b, i) => (
          <div key={i} className="rounded-lg border bg-background p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{b.type}</p>
              <span className="inline-flex gap-1">
                <Button type="button" size="xs" variant="outline" disabled={i === 0} onClick={() => setBlocks((cur) => cur.map((x, j) => (j === i - 1 ? cur[i] : j === i ? cur[i - 1] : x)))}>
                  Up
                </Button>
                <Button type="button" size="xs" variant="outline" disabled={i === blocks.length - 1} onClick={() => setBlocks((cur) => cur.map((x, j) => (j === i + 1 ? cur[i] : j === i ? cur[i + 1] : x)))}>
                  Down
                </Button>
                <Button type="button" size="xs" variant="outline" disabled={blocks.length <= 1} onClick={() => setBlocks((cur) => cur.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </span>
            </div>
            <BlockEditor idp={`s-${screen.id}-b${i}`} block={b} onChange={(nb) => setBlocks((cur) => cur.map((x, j) => (j === i ? nb : x)))} />
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`s-${screen.id}-add`} className="text-xs">
              Add a block to this screen
            </Label>
            <NativeSelect id={`s-${screen.id}-add`} value={addType} onChange={(e) => setAddType(e.target.value as Block["type"])} className="w-48">
              {BLOCK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={blocks.length >= 6} onClick={() => setBlocks((cur) => [...cur, newBlock(addType)])}>
            Add block
          </Button>
          <p className="text-xs text-muted-foreground">A screen holds 1 to 6 blocks. Block changes are saved with Save this screen.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving..." : "Save this screen"}
          </Button>
          <ScreenControls versionId={versionId} stamp={stamp} moduleKey={moduleKey} screenId={screen.id} title={screen.title} index={index} count={count} />
        </div>
      </form>
    </details>
  );
}

// ---- Exam questions -----------------------------------------------------------------------------------------------------------

export function QuestionEditor({ versionId, stamp, question, number }: { versionId: string; stamp: number; question: QuestionSeed & { id: string }; number: number }) {
  const { run, pending } = useSave();
  const [topic, setTopic] = useState(question.topic);
  const [stem, setStem] = useState(question.stem);
  const [options, setOptions] = useState(question.options);
  const [correct, setCorrect] = useState<string[]>(question.correctIds);
  const [why, setWhy] = useState(question.rationale);
  const { markSaved } = useWarnWhenEdited({ topic, stem, options, correct, why });
  const single = question.type !== "multiple";
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Q{number}. {question.stem}
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveStudioQuestion({ versionId, stamp, questionId: question.id, topic, stem, options, correctIds: correct, rationale: why }), "Saved.", markSaved);
        }}
      >
        <p className="text-xs text-muted-foreground">
          Type: {question.type.replace("_", "/")}. The answer key is visible to editors only.
        </p>
        <Field id={`q-${question.id}-stem`} label="Question">
          <Textarea id={`q-${question.id}-stem`} rows={2} value={stem} onChange={(e) => setStem(e.target.value)} maxLength={600} />
        </Field>
        <Field id={`q-${question.id}-topic`} label="Topic (shown after a failed try, so it must not give the answer away)">
          <Input id={`q-${question.id}-topic`} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={60} />
        </Field>
        {options.map((o, i) => (
          <div key={o.id} className="flex items-center gap-2">
            <input
              aria-label={`Option ${o.id.toUpperCase()} is correct`}
              type={single ? "radio" : "checkbox"}
              name={`correct-${question.id}`}
              className="size-4 accent-primary"
              checked={correct.includes(o.id)}
              onChange={(e) => setCorrect((cur) => (single ? [o.id] : e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)))}
            />
            <span className="w-5 text-sm font-medium">{o.id.toUpperCase()}</span>
            <Input aria-label={`Option ${o.id.toUpperCase()}`} value={o.text} onChange={(e) => setOptions((cur) => cur.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} maxLength={260} disabled={question.type === "true_false"} />
          </div>
        ))}
        <Field id={`q-${question.id}-why`} label="Why the answer is right (shown only after a pass)">
          <Textarea id={`q-${question.id}-why`} rows={2} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={700} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving..." : "Save this question"}
          </Button>
          <RemoveQuestionButton versionId={versionId} stamp={stamp} questionId={question.id} />
        </div>
      </form>
    </details>
  );
}
