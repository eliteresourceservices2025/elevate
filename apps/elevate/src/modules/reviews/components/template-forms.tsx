"use client";

/* eslint-disable security/detect-object-injection -- numeric list indexes */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useRun } from "@/modules/recruiting/components/use-run";
import { archiveReviewTemplate, launchReviewCycle, saveReviewTemplate, setEarlyReviews } from "../actions";
import { CYCLE_LABELS, CYCLE_TYPES, type CycleType, type Question } from "../constants";

type Q = Omit<Question, "id">;
const blank = (): Q => ({ section: "", prompt: "", type: "rating", required: true });

export function ReviewTemplateEditor({ template }: { template?: { id: string; name: string; questions: Question[] } }) {
  const { run, pending } = useRun();
  const key = template?.id ?? "new";
  const [name, setName] = useState(template?.name ?? "");
  const [qs, setQs] = useState<Q[]>(template?.questions.map(({ section, prompt, type, required }) => ({ section, prompt, type, required })) ?? [blank()]);
  const set = (i: number, patch: Partial<Q>) => setQs((l) => l.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveReviewTemplate({ id: template?.id, name, questions: qs }), "Template saved.");
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`rt-name-${key}`}>Template name</Label>
        <Input id={`rt-name-${key}`} value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={120} required />
      </div>
      <ol className="space-y-3">
        {qs.map((q, i) => (
          <li key={i} className="space-y-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_2fr_8rem]">
              <div className="space-y-1">
                <Label htmlFor={`rq-sec-${key}-${i}`}>Section</Label>
                <Input id={`rq-sec-${key}-${i}`} value={q.section} onChange={(e) => set(i, { section: e.target.value })} maxLength={80} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`rq-prompt-${key}-${i}`}>Question {i + 1}</Label>
                <Input id={`rq-prompt-${key}-${i}`} value={q.prompt} onChange={(e) => set(i, { prompt: e.target.value })} maxLength={300} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`rq-type-${key}-${i}`}>Answer</Label>
                <NativeSelect id={`rq-type-${key}-${i}`} value={q.type} onChange={(e) => set(i, { type: e.target.value as Q["type"] })}>
                  <option value="rating">Rating 1 to 5</option>
                  <option value="text">Text</option>
                </NativeSelect>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={q.required} onChange={(e) => set(i, { required: e.target.checked })} />
                Required
              </label>
              <Button type="button" size="sm" variant="ghost" disabled={qs.length === 1} onClick={() => setQs((l) => l.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setQs((l) => [...l, { ...blank(), section: l[l.length - 1]?.section ?? "" }])} disabled={qs.length >= 40}>
          Add a question
        </Button>
        <Button type="submit" disabled={pending}>
          Save template
        </Button>
        {template ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => archiveReviewTemplate({ templateId: template.id }), "Template archived.")}>
            Archive
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function EarlySettings({ enabled, templateId, templates }: { enabled: boolean; templateId: string | null; templates: { id: string; name: string }[] }) {
  const { run, pending } = useRun();
  const [on, setOn] = useState(enabled);
  const [tpl, setTpl] = useState(templateId ?? "");
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setEarlyReviews({ enabled: on, templateId: tpl }), "Saved.");
      }}
    >
      <h2 className="text-lg font-semibold">Early-engagement reviews</h2>
      <p className="text-sm text-muted-foreground">Opened automatically at month 3 and month 5 after a person&apos;s start date.</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Open them automatically
      </label>
      <div className="space-y-1">
        <Label htmlFor="early-tpl">Template</Label>
        <NativeSelect id="early-tpl" value={tpl} onChange={(e) => setTpl(e.target.value)}>
          <option value="">The built-in short template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export function LaunchCycleForm({ templates, teams, people, today }: { templates: { id: string; name: string }[]; teams: { id: string; name: string }[]; people: { id: string; name: string }[]; today: string }) {
  const { run, pending, router } = useRun();
  const [name, setName] = useState("");
  const [type, setType] = useState<CycleType>("quarterly");
  const [templateId, setTemplateId] = useState("");
  const [scopeKind, setScopeKind] = useState<"everyone" | "teams" | "people">("everyone");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [selfDueOn, setSelf] = useState(today);
  const [leadDueOn, setLead] = useState(today);
  const [calibrateDueOn, setCal] = useState(today);
  const toggle = (list: string[], id: string, set: (v: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const scope = scopeKind === "everyone" ? { kind: "everyone" } : scopeKind === "teams" ? { kind: "teams", teamIds } : { kind: "people", employeeIds };
  return (
    <form
      className="max-w-2xl space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => launchReviewCycle({ name, type, templateId, scope, selfDueOn, leadDueOn, calibrateDueOn }), (d) => `Cycle launched with ${(d as { reviews: number } | undefined)?.reviews ?? 0} reviews.`, (d) => router.push(`/reviews/cycles/${(d as { cycleId: string }).cycleId}`));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cy-name">Cycle name</Label>
          <Input id="cy-name" value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={120} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cy-type">Type</Label>
          <NativeSelect id="cy-type" value={type} onChange={(e) => setType(e.target.value as CycleType)}>
            {CYCLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {CYCLE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="cy-tpl">Template</Label>
        <NativeSelect id="cy-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
          <option value="">Choose a template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="cy-self">Self reviews due</Label>
          <Input id="cy-self" type="date" value={selfDueOn} min={today} onChange={(e) => setSelf(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cy-lead">Lead reviews due</Label>
          <Input id="cy-lead" type="date" value={leadDueOn} min={today} onChange={(e) => setLead(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cy-cal">Calibration due</Label>
          <Input id="cy-cal" type="date" value={calibrateDueOn} min={today} onChange={(e) => setCal(e.target.value)} required />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who is reviewed</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["everyone", "teams", "people"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name="scope" checked={scopeKind === k} onChange={() => setScopeKind(k)} />
              {k === "everyone" ? "Everyone" : k === "teams" ? "Some teams" : "Chosen people"}
            </label>
          ))}
        </div>
        {scopeKind === "teams" ? (
          <div className="flex flex-wrap gap-3">
            {teams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => toggle(teamIds, t.id, setTeamIds)} />
                {t.name}
              </label>
            ))}
          </div>
        ) : null}
        {scopeKind === "people" ? (
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={employeeIds.includes(p.id)} onChange={() => toggle(employeeIds, p.id, setEmployeeIds)} />
                {p.name}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>
      <Button type="submit" disabled={pending || !templateId}>
        Launch cycle
      </Button>
    </form>
  );
}
