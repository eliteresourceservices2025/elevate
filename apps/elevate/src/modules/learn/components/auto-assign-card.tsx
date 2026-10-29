"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { setAutoAssign } from "../actions";

type Mode = "all" | "teams" | "paused";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "all", label: "Everyone", hint: "Each night, everyone active who needs this course is assigned it. That includes new hires still in onboarding; one who has not signed in yet is assigned the night after their first sign-in." },
  { value: "teams", label: "Chosen teams only", hint: "Only people whose team is ticked are assigned automatically. Anyone else can still be assigned by hand." },
  { value: "paused", label: "Paused", hint: "Nobody is assigned automatically. People already assigned keep their reminders; leavers are still closed out." },
];

/** HR chooses who a course is assigned to automatically each night (a pilot team first, then everyone). */
export function AutoAssignCard({
  course,
  courseLabel,
  initial,
  teams,
  updatedText,
}: {
  course: string;
  courseLabel: string;
  initial: { mode: Mode; teamIds: string[] };
  teams: { id: string; name: string }[];
  updatedText: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [teamIds, setTeamIds] = useState<string[]>(initial.teamIds);
  const dirty = mode !== initial.mode || (mode === "teams" && [...teamIds].sort().join() !== [...initial.teamIds].sort().join());

  const save = () =>
    start(async () => {
      try {
        const r = await setAutoAssign({ course, mode, teamIds: mode === "teams" ? teamIds : [] });
        if (!r.ok) return void toast.error(r.error);
        toast.success("Saved.");
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });

  return (
    <section aria-label="Automatic assignment" className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Automatic assignment: {courseLabel}</h2>
        <p className="text-sm text-muted-foreground">Who gets this course without HR assigning it by hand.{updatedText ? ` ${updatedText}` : ""}</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">Who is assigned automatically</legend>
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name={`mode-${course}`} className="mt-1 size-4 accent-primary" checked={mode === m.value} onChange={() => setMode(m.value)} />
            <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-xs text-muted-foreground">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "teams" ? (
        <fieldset className="space-y-1.5 rounded-lg border p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Teams</legend>
          {teams.length === 0 ? <p className="text-sm text-muted-foreground">There are no teams yet.</p> : null}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {teams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={teamIds.includes(t.id)}
                  onChange={(e) => setTeamIds((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))}
                />
                {t.name}
              </label>
            ))}
          </div>
          {teamIds.length === 0 ? <p className="text-xs text-destructive">Tick at least one team, or choose Paused.</p> : null}
        </fieldset>
      ) : null}
      <Button size="sm" disabled={pending || !dirty || (mode === "teams" && teamIds.length === 0)} onClick={save}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </section>
  );
}
