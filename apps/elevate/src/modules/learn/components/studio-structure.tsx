"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useAsk } from "@/components/confirm-dialog";
import {
  addStudioModule,
  addStudioQuestion,
  addStudioScreen,
  moveStudioModule,
  moveStudioScreen,
  removeStudioModule,
  removeStudioQuestion,
  removeStudioScreen,
  saveStudioExamRules,
} from "../studio-actions";

type Result = { ok: boolean; error?: string };

function useDo() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, ok: string, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) return void toast.error(r.error ?? "Something went wrong.");
        toast.success(ok);
        after?.();
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return { run, pending };
}

const TRACKS = ["full", "essentials", "refresher"] as const;

/** Up, down and remove for one row (a module or a screen). */
function RowControls({ index, count, onMove, onRemove, pending, what }: { index: number; count: number; onMove: (d: "up" | "down") => void; onRemove: () => void; pending: boolean; what: string }) {
  const ask = useAsk();
  return (
    <span className="inline-flex items-center gap-1">
      <Button type="button" size="xs" variant="outline" disabled={pending || index === 0} onClick={() => onMove("up")} aria-label={`Move ${what} up`}>
        Up
      </Button>
      <Button type="button" size="xs" variant="outline" disabled={pending || index === count - 1} onClick={() => onMove("down")} aria-label={`Move ${what} down`}>
        Down
      </Button>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          if ((await ask(`Remove ${what}? This cannot be undone once saved.`))) onRemove();
        }}
        aria-label={`Remove ${what}`}
      >
        Remove
      </Button>
    </span>
  );
}

export function ModuleControls({ versionId, stamp, moduleKey, title, index, count }: { versionId: string; stamp: number; moduleKey: string; title: string; index: number; count: number }) {
  const { run, pending } = useDo();
  return (
    <RowControls
      what={`the module ${title}`}
      index={index}
      count={count}
      pending={pending}
      onMove={(direction) => run(() => moveStudioModule({ versionId, stamp, moduleKey, direction }), "Moved.")}
      onRemove={() => run(() => removeStudioModule({ versionId, stamp, moduleKey }), "Module removed, with its exam questions.")}
    />
  );
}

export function ScreenControls({ versionId, stamp, moduleKey, screenId, title, index, count }: { versionId: string; stamp: number; moduleKey: string; screenId: string; title: string; index: number; count: number }) {
  const { run, pending } = useDo();
  return (
    <RowControls
      what={`the screen ${title}`}
      index={index}
      count={count}
      pending={pending}
      onMove={(direction) => run(() => moveStudioScreen({ versionId, stamp, moduleKey, screenId, direction }), "Moved.")}
      onRemove={() => run(() => removeStudioScreen({ versionId, stamp, moduleKey, screenId }), "Screen removed.")}
    />
  );
}

export function AddModuleForm({ versionId, stamp }: { versionId: string; stamp: number }) {
  const { run, pending } = useDo();
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [tracks, setTracks] = useState<string[]>(["full"]);
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addStudioModule({ versionId, stamp, title, estimatedMinutes: minutes, tracks }), "Module added with placeholder text to replace.", () => setTitle(""));
      }}
    >
      <h2 className="text-lg font-semibold">Add a module</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1 space-y-1">
          <Label htmlFor="am-title">Title</Label>
          <Input id="am-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="am-min">Minutes</Label>
          <Input id="am-min" type="number" min={1} max={120} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-24" />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Tracks</legend>
          <div className="flex gap-3">
            {TRACKS.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={tracks.includes(t)} onChange={(e) => setTracks((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))} />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" size="sm" disabled={pending || !title.trim() || tracks.length === 0}>
          Add module
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">A new module starts with three screens, three key points and no exam questions, all marked TO WRITE. It cannot be published until that text is replaced.</p>
    </form>
  );
}

export function AddScreenForm({ versionId, stamp, moduleKey }: { versionId: string; stamp: number; moduleKey: string }) {
  const { run, pending } = useDo();
  const [title, setTitle] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addStudioScreen({ versionId, stamp, moduleKey, title }), "Screen added at the end.", () => setTitle(""));
      }}
    >
      <div className="min-w-60 flex-1 space-y-1">
        <Label htmlFor="as-title">Add a screen at the end</Label>
        <Input id="as-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Screen title" required />
      </div>
      <Button type="submit" size="sm" disabled={pending || !title.trim()}>
        Add screen
      </Button>
    </form>
  );
}

const QUESTION_TYPES = [
  { value: "single", label: "One correct answer" },
  { value: "multiple", label: "Select all that apply" },
  { value: "true_false", label: "True or false" },
  { value: "scenario", label: "Scenario, one correct answer" },
] as const;

export function AddQuestionForm({ versionId, stamp, moduleKey }: { versionId: string; stamp: number; moduleKey: string }) {
  const { run, pending } = useDo();
  const [type, setType] = useState<(typeof QUESTION_TYPES)[number]["value"]>("single");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addStudioQuestion({ versionId, stamp, moduleKey, type }), "Question added with placeholder text to replace.");
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`aq-${moduleKey}`} className="text-xs">
          Add a question
        </Label>
        <NativeSelect id={`aq-${moduleKey}`} value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-60">
          {QUESTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Add
      </Button>
    </form>
  );
}

export function RemoveQuestionButton({ versionId, stamp, questionId }: { versionId: string; stamp: number; questionId: string }) {
  const ask = useAsk();
  const { run, pending } = useDo();
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={async () => {
        if ((await ask("Remove this question from the bank?"))) run(() => removeStudioQuestion({ versionId, stamp, questionId }), "Question removed.");
      }}
    >
      Remove this question
    </Button>
  );
}

export function ExamRulesForm({ versionId, stamp, config }: { versionId: string; stamp: number; config: { passPercent?: number; maxTries?: number; waitMinutesAfterFail?: number; renewalMonths?: number; tracks?: Record<string, { questions: number }> } }) {
  const { run, pending } = useDo();
  const [pass, setPass] = useState(config.passPercent ?? 80);
  const [tries, setTries] = useState(config.maxTries ?? 3);
  const [wait, setWait] = useState(config.waitMinutesAfterFail ?? 60);
  const [months, setMonths] = useState(config.renewalMonths ?? 12);
  const [tracks, setTracks] = useState<Record<string, number>>(Object.fromEntries(Object.entries(config.tracks ?? {}).map(([t, v]) => [t, v.questions])));
  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value));
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveStudioExamRules({ versionId, stamp, passPercent: pass, maxTries: tries, waitMinutesAfterFail: wait, renewalMonths: months, tracks }), "Saved.");
      }}
    >
      <h2 className="text-lg font-semibold">Exam and certificate rules</h2>
      <div className="flex flex-wrap gap-4">
        {[
          { id: "er-pass", label: "Pass mark (%)", value: pass, set: setPass, min: 50, max: 100 },
          { id: "er-tries", label: "Tries", value: tries, set: setTries, min: 1, max: 10 },
          { id: "er-wait", label: "Wait after a fail (minutes)", value: wait, set: setWait, min: 0, max: 1440 },
          { id: "er-months", label: "Certificate valid (months)", value: months, set: setMonths, min: 1, max: 60 },
        ].map((f) => (
          <div key={f.id} className="space-y-1">
            <Label htmlFor={f.id}>{f.label}</Label>
            <Input id={f.id} type="number" min={f.min} max={f.max} value={f.value} onChange={num(f.set)} className="w-32" />
          </div>
        ))}
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Questions in each track&apos;s exam</legend>
        <div className="flex flex-wrap gap-4">
          {Object.entries(tracks).map(([t, n]) => (
            <div key={t} className="space-y-1">
              <Label htmlFor={`er-t-${t}`}>{t}</Label>
              <Input id={`er-t-${t}`} type="number" min={1} max={50} value={n} onChange={(e) => setTracks((cur) => ({ ...cur, [t]: Number(e.target.value) }))} className="w-28" />
            </div>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">Changing these affects people who start the new version. Check the client agreements before shortening how long a certificate is valid.</p>
      <Button type="submit" size="sm" disabled={pending}>
        Save the rules
      </Button>
    </form>
  );
}
