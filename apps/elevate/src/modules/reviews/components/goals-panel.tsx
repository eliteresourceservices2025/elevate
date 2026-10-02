"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateOnly } from "@/lib/time";
import { useRun } from "@/modules/recruiting/components/use-run";
import { addGoalNote, archiveGoal, saveGoal, setGoalStatus } from "../goals-actions";
import { GOAL_LABELS, GOAL_STATUSES, type GoalStatus } from "../constants";
import type { GoalView } from "../queries";

export function NewGoalForm({ people }: { people: { id: string; name: string }[] }) {
  const { run, pending } = useRun();
  const [employeeId, setEmployee] = useState(people.length === 1 ? people[0].id : "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetOn, setTarget] = useState("");
  if (people.length === 0) return null;
  return (
    <form
      className="max-w-xl space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveGoal({ employeeId, title, description, targetOn }), "Goal added.", () => (setTitle(""), setDescription(""), setTarget("")));
      }}
    >
      <h2 className="text-lg font-semibold">Add a goal</h2>
      {people.length > 1 ? (
        <div className="space-y-1">
          <Label htmlFor="goal-person">For</Label>
          <NativeSelect id="goal-person" value={employeeId} onChange={(e) => setEmployee(e.target.value)} required>
            <option value="">Choose a person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="goal-title">Goal</Label>
        <Input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={160} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="goal-desc">Details (optional)</Label>
        <Textarea id="goal-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="goal-target">Target date (optional)</Label>
        <Input id="goal-target" type="date" value={targetOn} onChange={(e) => setTarget(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending || !employeeId}>
        Add goal
      </Button>
    </form>
  );
}

export function GoalCard({ goal }: { goal: GoalView }) {
  const { run, pending } = useRun();
  const [note, setNote] = useState("");
  return (
    <li className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{goal.title}</p>
          {goal.mine ? null : <p className="text-xs text-muted-foreground">{goal.name}</p>}
          {goal.description ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{goal.description}</p> : null}
          {goal.targetOn ? <p className="text-xs text-muted-foreground">Target {formatDateOnly(goal.targetOn)}</p> : null}
        </div>
        {goal.canManage ? (
          <NativeSelect aria-label={`Status of ${goal.title}`} className="w-40" value={goal.status} disabled={pending} onChange={(e) => run(() => setGoalStatus({ goalId: goal.id, status: e.target.value }), "Status updated.")}>
            {GOAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {/* eslint-disable-next-line security/detect-object-injection -- s comes from the fixed GOAL_STATUSES list */}
                {GOAL_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Badge variant="secondary">{GOAL_LABELS[goal.status as GoalStatus]}</Badge>
        )}
      </div>
      {goal.notes.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {goal.notes.map((n) => (
            <li key={n.id} className="text-muted-foreground">
              {n.note} <span className="text-xs">({n.createdAt.toISOString().slice(0, 10)})</span>
            </li>
          ))}
        </ul>
      ) : null}
      {goal.canManage ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addGoalNote({ goalId: goal.id, note }), "Note added.", () => setNote(""));
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`gn-${goal.id}`}>Progress note</Label>
            <Input id={`gn-${goal.id}`} className="w-72" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={pending || !note.trim()}>
            Add note
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => archiveGoal({ goalId: goal.id }), "Goal archived.")}>
            Archive
          </Button>
        </form>
      ) : null}
    </li>
  );
}
