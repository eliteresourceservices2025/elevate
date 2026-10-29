"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useWarnWhenEdited } from "@/components/unsaved-changes";
import type { Block, CourseContent, CourseModule, QuestionSeed } from "../../../../../learn/src/content/schema";
import { createStudioAddon, createStudioDraft, discardStudioDraft, publishStudioDraft, removeStudioAddon, saveStudioCourseMeta, saveStudioModuleMeta, saveStudioQuestion, saveStudioScreen } from "../studio-actions";
import { formatBranch, formatBuild, formatCards, formatFlip, formatGame, formatHotspot, formatRecord, formatSpot, parseBranch, parseBuild, parseCards, parseFlip, parseGame, parseHotspot, parseRecord, parseSpot } from "../studio-block-text";
import { newBlock } from "../studio-scaffold";
import { RemoveQuestionButton, ScreenControls } from "./studio-structure";
import { useAsk } from "@/components/confirm-dialog";

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
      className="space-y-4"
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
      <div>
        <Field id={`note-${fromVersion ?? "latest"}`} label={fromVersion ? `New draft from version ${fromVersion}: what is it for?` : "New draft from the latest version: what is it for?"}>
          <Input id={`note-${fromVersion ?? "latest"}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required placeholder="For example: update the incident deadlines after counsel's review" />
        </Field>
      </div>
      <Button type="submit" disabled={pending || note.trim().length < 3}>
        Start a draft
      </Button>
    </form>
  );
}

export function NewAddonForm({ clients }: { clients: { id: string; name: string; existing: number }[] }) {
  const { run, pending, router } = useSave();
  const [clientId, setClientId] = useState("");
  const [topic, setTopic] = useState("");
  const [ackOnly, setAckOnly] = useState(false);
  const existing = clients.find((c) => c.id === clientId)?.existing ?? 0;
  if (clients.length === 0) return <p className="text-sm text-muted-foreground">There are no active clients yet.</p>;
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          async () => {
            const r = await createStudioAddon({ clientId, ...(existing > 0 ? { topic } : {}), ...(ackOnly ? { acknowledgmentOnly: true } : {}) });
            if (r.ok) router.push(`/course-studio/${r.data.slug}/${r.data.version}`);
            return r;
          },
          "Add-on created. Write its lessons and questions.",
        );
      }}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field id="addon-client" label="Client">
          <NativeSelect id="addon-client" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.existing > 0 ? ` (${c.existing} add-on${c.existing === 1 ? "" : "s"} already)` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {existing > 0 ? (
          <Field id="addon-topic" label="Topic" hint="A few words to tell this add-on apart from the client's other ones, for example Billing policy.">
            <Input id="addon-topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={40} required />
          </Field>
        ) : null}
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={ackOnly} onChange={(e) => setAckOnly(e.target.checked)} />
        <span>
          <span className="font-medium">Acknowledgment only</span>
          <span className="block text-muted-foreground">No exam: reading every module and accepting the statement finishes it.</span>
        </span>
      </label>
      <div>
        <Button type="submit" disabled={pending || !clientId || (existing > 0 && topic.trim().length < 2)}>
          {pending ? "Creating..." : "Create the add-on"}
        </Button>
      </div>
    </form>
  );
}

export function DiscardDraftButton({ versionId, stamp, course }: { versionId: string; stamp: number; course: string }) {
  const ask = useAsk();
  const { run, pending, router } = useSave();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!(await ask("Discard this draft? Its edits are deleted and cannot be brought back."))) return;
        run(
          async () => {
            const r = await discardStudioDraft({ versionId, stamp });
            if (r.ok) router.push(r.data.courseGone ? "/course-studio" : `/course-studio/${course}`);
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

export function PublishCard({ versionId, canPublish, blocked, addon = false }: { versionId: string; canPublish: boolean; blocked: string | null; addon?: boolean }) {
  const ask = useAsk();
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
        onSubmit={async (e) => {
          e.preventDefault();
          if (!(await ask("Publish now? A published version is frozen. People already on the old version finish it."))) return;
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
          <Field id="pub-date" label={addon ? "Date the text was approved (by counsel or the client)" : "Date counsel approved the text"}>
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

/** A text box that keeps its raw text while typing (blank lines and half-typed lines survive); it resets only when the block changes underneath it. */
function TextLines({ id, label, hint, value, rows, normalize, onText }: { id: string; label: string; hint?: string; value: string; rows: number; normalize: (text: string) => string; onText: (text: string) => void }) {
  const [text, setText] = useState(value);
  if (normalize(text) !== value && text !== value) setText(value);
  return (
    <Field id={id} label={label} hint={hint}>
      <Textarea
        id={id}
        rows={Math.max(rows, text.split("\n").length + 1)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onText(e.target.value);
        }}
      />
    </Field>
  );
}

const OPTION_HINT = 'Start a right answer with + and a wrong one with -, then "text | why". Leave a blank line between items.';

function InteractiveEditor({ block, onChange, idp }: { block: Extract<Block, { type: "sort" | "cards" | "spot" | "hotspot" | "flip" | "build" | "branch" | "game" }>; onChange: (b: Block) => void; idp: string }) {
  const head = (title: string | undefined, set: (v: string) => void, required = true) => (
    <Field id={`${idp}-title`} label={required ? "Title" : "Title (optional)"}>
      <Input id={`${idp}-title`} value={title ?? ""} onChange={(e) => set(e.target.value)} maxLength={160} />
    </Field>
  );
  const prompt = (value: string, set: (v: string) => void, label = "Instructions for the learner", suffix = "prompt") => (
    <Field id={`${idp}-${suffix}`} label={label}>
      <Textarea id={`${idp}-${suffix}`} rows={2} value={value} onChange={(e) => set(e.target.value)} maxLength={900} />
    </Field>
  );
  switch (block.type) {
    case "sort":
      return (
        <div className="space-y-2">
          {head(block.title, (v) => onChange({ ...block, title: v }))}
          {prompt(block.prompt, (v) => onChange({ ...block, prompt: v }))}
          <Field id={`${idp}-items`} label="Steps in the CORRECT order (one per line, 2 to 7); the learner sees them shuffled">
            <Textarea id={`${idp}-items`} rows={Math.max(4, block.items.length + 1)} value={block.items.join("\n")} onChange={(e) => onChange({ ...block, items: lines(e.target.value) })} />
          </Field>
          {prompt(block.explanation, (v) => onChange({ ...block, explanation: v }), "Why this is the order (shown after checking)", "why")}
        </div>
      );
    case "cards":
      return (
        <div className="space-y-2">
          {head(block.title, (v) => onChange({ ...block, title: v }))}
          {prompt(block.prompt, (v) => onChange({ ...block, prompt: v }))}
          <Field id={`${idp}-groups`} label="Groups (one per line, 2 or 3)">
            <Textarea id={`${idp}-groups`} rows={3} value={block.groups.join("\n")} onChange={(e) => onChange({ ...block, groups: lines(e.target.value) })} />
          </Field>
          <TextLines id={`${idp}-cards`} label='Cards, one per line as "card text | group number | why" (3 to 10)' value={formatCards(block)} rows={5} normalize={(t) => formatCards({ ...block, cards: parseCards(t) })} onText={(t) => onChange({ ...block, cards: parseCards(t) })} />
        </div>
      );
    case "spot":
      return (
        <div className="space-y-2">
          {head(block.title, (v) => onChange({ ...block, title: v }))}
          {prompt(block.prompt, (v) => onChange({ ...block, prompt: v }))}
          <TextLines id={`${idp}-lines`} label='Lines, one per line as "Speaker | what they say"; add "| wrong" to the mistake' value={formatSpot(block)} rows={5} normalize={(t) => formatSpot({ ...block, lines: parseSpot(t) })} onText={(t) => onChange({ ...block, lines: parseSpot(t) })} />
          {prompt(block.explanation, (v) => onChange({ ...block, explanation: v }), "What was wrong and why (shown when found)", "why")}
        </div>
      );
    case "hotspot":
      return (
        <div className="space-y-2">
          {head(block.title, (v) => onChange({ ...block, title: v }))}
          {prompt(block.prompt, (v) => onChange({ ...block, prompt: v }))}
          <TextLines id={`${idp}-items`} label='Things in the scene, one per line as "Label | what is shown"; for a problem add "| problem | why it is a problem" (4 to 10)' value={formatHotspot(block)} rows={6} normalize={(t) => formatHotspot({ ...block, items: parseHotspot(t) })} onText={(t) => onChange({ ...block, items: parseHotspot(t) })} />
          {prompt(block.explanation, (v) => onChange({ ...block, explanation: v }), "What to take away (shown after checking)", "why")}
        </div>
      );
    case "flip":
      return (
        <div className="space-y-2">
          {head(block.title, (v) => onChange({ ...block, title: v || undefined }), false)}
          <TextLines id={`${idp}-flip`} label='Cards, one per line as "front | back" (2 to 8)' value={formatFlip(block)} rows={4} normalize={(t) => formatFlip({ ...block, cards: parseFlip(t) })} onText={(t) => onChange({ ...block, cards: parseFlip(t) })} />
        </div>
      );
    case "build":
      return (
        <div className="space-y-2">
          {head(block.title, (v) => onChange({ ...block, title: v }))}
          {prompt(block.prompt, (v) => onChange({ ...block, prompt: v }))}
          <TextLines id={`${idp}-slots`} label="Parts: a name line, then its options (2 to 6 parts, one right option each)" hint={OPTION_HINT} value={formatBuild(block)} rows={8} normalize={(t) => formatBuild({ ...block, slots: parseBuild(t) })} onText={(t) => onChange({ ...block, slots: parseBuild(t) })} />
        </div>
      );
    case "branch":
      return (
        <div className="space-y-2">
          {head(block.title, (v) => onChange({ ...block, title: v }))}
          {prompt(block.intro, (v) => onChange({ ...block, intro: v }), "Set the scene (invented people only)", "intro")}
          <Field id={`${idp}-rtitle`} label="Customer record title (optional, shown beside the call)">
            <Input id={`${idp}-rtitle`} value={block.record?.title ?? ""} onChange={(e) => onChange({ ...block, record: e.target.value || block.record?.rows.length ? { title: e.target.value, rows: block.record?.rows ?? [] } : undefined })} maxLength={160} />
          </Field>
          <TextLines id={`${idp}-rrows`} label={"Record facts, one per line as \"label | value\" (1 to 6, invented people only)"} value={formatRecord(block.record?.rows ?? [])} rows={3} normalize={(t) => formatRecord(parseRecord(t))} onText={(t) => onChange({ ...block, record: block.record?.title || parseRecord(t).length ? { title: block.record?.title ?? "", rows: parseRecord(t) } : undefined })} />
          <TextLines
            id={`${idp}-turns`}
            label='Turns: the caller line, then replies as "your reply | mood change | how the caller answers"'
            hint="Mood change is a whole number from -30 to 30. Leave a blank line between turns (2 to 6 turns)."
            value={formatBranch(block)}
            rows={10}
            normalize={(t) => formatBranch({ ...block, turns: parseBranch(t) })}
            onText={(t) => onChange({ ...block, turns: parseBranch(t) })}
          />
        </div>
      );
    case "game":
      return (
        <div className="space-y-2">
          {head(block.title, (v) => onChange({ ...block, title: v }))}
          <Field id={`${idp}-seconds`} label="Seconds per round (optional, 5 to 60; empty means no timer)">
            <Input id={`${idp}-seconds`} type="number" min={5} max={60} value={block.seconds ?? ""} onChange={(e) => onChange({ ...block, seconds: e.target.value ? Number(e.target.value) : undefined })} />
          </Field>
          <TextLines id={`${idp}-rounds`} label="Rounds: a question line, then its options (3 to 10 rounds)" hint={OPTION_HINT} value={formatGame(block)} rows={10} normalize={(t) => formatGame({ ...block, rounds: parseGame(t) })} onText={(t) => onChange({ ...block, rounds: parseGame(t) })} />
        </div>
      );
  }
}

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
    case "table":
      return (
        <div className="space-y-2">
          <Field id={`${idp}-cap`} label="Table caption (optional)">
            <Input id={`${idp}-cap`} value={block.caption ?? ""} onChange={(e) => onChange({ ...block, caption: e.target.value || undefined })} maxLength={160} />
          </Field>
          <Field id={`${idp}-cols`} label="Column headings (one per line, 2 to 4)">
            <Textarea
              id={`${idp}-cols`}
              rows={3}
              value={block.columns.join("\n")}
              onChange={(e) => {
                const columns = lines(e.target.value);
                // keep every row as wide as the headings so the table stays valid while editing
                onChange({ ...block, columns, rows: block.rows.map((r) => Array.from({ length: Math.max(columns.length, 2) }, (_, i) => r[i] ?? "TO WRITE:")) });
              }}
            />
          </Field>
          <Field id={`${idp}-rows`} label="Rows (one per line, cells separated by | )">
            <Textarea
              id={`${idp}-rows`}
              rows={Math.max(4, block.rows.length + 1)}
              value={block.rows.map((r) => r.join(" | ")).join("\n")}
              onChange={(e) => onChange({ ...block, rows: lines(e.target.value).map((l) => l.split("|").map((c) => c.trim())) })}
            />
          </Field>
        </div>
      );
    case "layers":
    case "timeline": {
      const key = block.type === "layers" ? "label" : "when";
      const items = block.items as Record<string, string>[];
      return (
        <div className="space-y-2">
          <Field id={`${idp}-title`} label={block.type === "layers" ? "Layers title (optional)" : "Timeline title (optional)"}>
            <Input id={`${idp}-title`} value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value || undefined })} maxLength={160} />
          </Field>
          <Field id={`${idp}-items`} label={`Items, one per line as "${key === "label" ? "Layer name" : "When"} | text"`}>
            <Textarea
              id={`${idp}-items`}
              rows={Math.max(4, items.length + 1)}
              value={items.map((it) => `${it[key]} | ${it.text}`).join("\n")}
              onChange={(e) => {
                const next = lines(e.target.value).map((l) => {
                  const [head, ...rest] = l.split("|");
                  return { [key]: head.trim(), text: rest.join("|").trim() };
                });
                onChange({ ...block, items: next } as Block);
              }}
            />
          </Field>
        </div>
      );
    }
    case "glossary":
      return (
        <Field id={idp} label={'Terms, one per line as "Term | meaning"'}>
          <Textarea
            id={idp}
            rows={Math.max(4, block.terms.length + 1)}
            value={block.terms.map((t) => `${t.term} | ${t.meaning}`).join("\n")}
            onChange={(e) =>
              onChange({
                ...block,
                terms: lines(e.target.value).map((l) => {
                  const [head, ...rest] = l.split("|");
                  return { term: head.trim(), meaning: rest.join("|").trim() };
                }),
              })
            }
          />
        </Field>
      );
    case "case":
      return (
        <div className="space-y-2">
          <Field id={`${idp}-t`} label="Case title">
            <Input id={`${idp}-t`} value={block.title} onChange={(e) => onChange({ ...block, title: e.target.value })} maxLength={160} />
          </Field>
          <Field id={idp} label="The situation">
            <Textarea id={idp} rows={4} value={block.scenario} onChange={(e) => onChange({ ...block, scenario: e.target.value })} maxLength={900} />
          </Field>
          <Field id={`${idp}-q`} label="The question">
            <Input id={`${idp}-q`} value={block.question} onChange={(e) => onChange({ ...block, question: e.target.value })} maxLength={160} />
          </Field>
          <Field id={`${idp}-a`} label="The answer (shown when the person asks)">
            <Textarea id={`${idp}-a`} rows={4} value={block.answer} onChange={(e) => onChange({ ...block, answer: e.target.value })} maxLength={900} />
          </Field>
        </div>
      );
    case "sort":
    case "cards":
    case "spot":
    case "hotspot":
    case "flip":
    case "build":
    case "branch":
    case "game":
      return <InteractiveEditor block={block} onChange={onChange} idp={idp} />;
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
  { value: "case", label: "Worked case (answer on request)" },
  { value: "table", label: "Table" },
  { value: "layers", label: "Layers" },
  { value: "timeline", label: "Timeline" },
  { value: "glossary", label: "Glossary" },
  { value: "sort", label: "Sort it (put in order)" },
  { value: "cards", label: "Sort cards into groups" },
  { value: "spot", label: "Spot the mistake" },
  { value: "hotspot", label: "Tap the problems" },
  { value: "flip", label: "Flip cards" },
  { value: "build", label: "Build it (pick the parts)" },
  { value: "branch", label: "Call with a mood meter" },
  { value: "game", label: "Quiz game (rounds)" },
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

const TYPE_LABELS: Record<string, string> = { single: "One correct answer", multiple: "Select all that apply", true_false: "True or false", scenario: "Scenario (one correct answer)" };
const NEXT_ID = ["a", "b", "c", "d", "e", "f"];

export function QuestionEditor({ versionId, stamp, question, number, modules }: { versionId: string; stamp: number; question: QuestionSeed & { id: string }; number: number; modules: { key: string; title: string }[] }) {
  const { run, pending } = useSave();
  const [topic, setTopic] = useState(question.topic);
  const [stem, setStem] = useState(question.stem);
  const [options, setOptions] = useState(question.options);
  const [correct, setCorrect] = useState<string[]>(question.correctIds);
  const [why, setWhy] = useState(question.rationale);
  const [type, setType] = useState<string>(question.type);
  const [moduleKey, setModuleKey] = useState(question.moduleKey);
  const { markSaved } = useWarnWhenEdited({ topic, stem, options, correct, why, type, moduleKey });
  const single = type !== "multiple";
  const changeType = (next: string) => {
    setType(next);
    if (next === "true_false") {
      setOptions([
        { id: "a", text: "True" },
        { id: "b", text: "False" },
      ]);
      setCorrect(["a"]);
    } else if (next !== "multiple") {
      setCorrect((cur) => cur.slice(0, 1));
    }
  };
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Q{number}. {question.stem}
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveStudioQuestion({ versionId, stamp, questionId: question.id, topic, stem, options, correctIds: correct, rationale: why, type, moduleKey }), "Saved.", markSaved);
        }}
      >
        <p className="text-xs text-muted-foreground">The answer key is visible to editors only. Changing the type or the module keeps the question&apos;s history.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`q-${question.id}-type`} label="Type">
            <NativeSelect id={`q-${question.id}-type`} value={type} onChange={(e) => changeType(e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={`q-${question.id}-module`} label="Module">
            <NativeSelect id={`q-${question.id}-module`} value={moduleKey} onChange={(e) => setModuleKey(e.target.value)}>
              {modules.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
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
        {type !== "true_false" ? (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={options.length >= 6} onClick={() => setOptions((cur) => [...cur, { id: NEXT_ID[cur.length], text: "" }])}>
              Add an option
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={options.length <= 3}
              onClick={() => {
                setOptions((cur) => cur.slice(0, -1));
                setCorrect((cur) => cur.filter((id) => id !== options[options.length - 1]?.id));
              }}
            >
              Remove the last option
            </Button>
          </div>
        ) : null}
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

/** Removes a client add-on that never went live. Only offered for those: a live add-on is part of the training record. */
export function RemoveAddonButton({ course, title, redirectTo }: { course: string; title: string; redirectTo?: string }) {
  const ask = useAsk();
  const { run, pending, router } = useSave();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!(await ask(`Remove the add-on "${title}"? Its draft is deleted and cannot be brought back.`))) return;
        run(
          async () => {
            const r = await removeStudioAddon({ course });
            if (r.ok && redirectTo) router.push(redirectTo);
            return r;
          },
          "Add-on removed.",
        );
      }}
    >
      Remove this add-on
    </Button>
  );
}
