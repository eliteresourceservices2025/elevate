"use client";

import { useState } from "react";
import { useRun } from "@/modules/attendance/components/use-run";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/form-fields";
import { useFormDialog } from "@/components/form-dialog";
import { useAsk } from "@/components/confirm-dialog";
import { archiveCategory, saveActivitySettings, saveCategory } from "../actions";
import type { ActivitySettingsView } from "../queries";

/** The three company-wide numbers the app and the nightly flags use. */
export function ThresholdsForm({ settings }: { settings: ActivitySettingsView }) {
  const { run, pending } = useRun();
  const [idle, setIdle] = useState(String(settings.idleTimeoutSeconds));
  const [grace, setGrace] = useState(String(settings.offlineGraceMinutes));
  const [low, setLow] = useState(String(settings.lowActivityPercent));
  const nums = { idleTimeoutSeconds: Number(idle), offlineGraceMinutes: Number(grace), lowActivityPercent: Number(low) };
  const bad = {
    idle: !Number.isInteger(nums.idleTimeoutSeconds) || nums.idleTimeoutSeconds < 60 || nums.idleTimeoutSeconds > 900 ? "Enter 60 to 900 seconds." : undefined,
    grace: !Number.isInteger(nums.offlineGraceMinutes) || nums.offlineGraceMinutes < 2 || nums.offlineGraceMinutes > 60 ? "Enter 2 to 60 minutes." : undefined,
    low: !Number.isInteger(nums.lowActivityPercent) || nums.lowActivityPercent < 5 || nums.lowActivityPercent > 90 ? "Enter 5 to 90 percent." : undefined,
  };
  return (
    <form
      aria-label="Thresholds"
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (bad.idle || bad.grace || bad.low) return;
        run(() => saveActivitySettings(nums), () => "Saved. The new numbers apply from now on.");
      }}
    >
      <TextField id="idle" label="Idle after (seconds)" inputMode="numeric" value={idle} onChange={(e) => setIdle(e.target.value)} error={bad.idle} hint="No keyboard or mouse for this long counts as idle. The app picks it up at its next check." />
      <TextField id="grace" label="Offline wait (minutes)" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} error={bad.grace} hint="How long a clocked-in person's app can stay silent before the lead is told (10 minutes are added)." />
      <TextField id="low" label="Low activity below (percent)" inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} error={bad.low} hint="Under this share of recorded time active, a day gets a Low activity note." />
      <div className="sm:col-span-3">
        <Button type="submit" disabled={pending || Boolean(bad.idle || bad.grace || bad.low)}>
          {pending ? "Saving…" : "Save thresholds"}
        </Button>
      </div>
    </form>
  );
}

/** Add a work / non-work rule. Opens inside a FormDialog. */
export function CategoryForm() {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("work");
  const [rank, setRank] = useState("10");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveCategory({ pattern, category, rank: Number(rank) }), () => "Rule added.", () => void dialog?.close(true));
      }}
    >
      <TextField id="pattern" label="App name pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} required maxLength={80} hint="Matches the app name, any capitals. For example: zoom, or ^excel$ for exactly Excel." />
      <SelectField id="category" label="Counts as" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="work">Work</option>
        <option value="non_work">Not work</option>
      </SelectField>
      <TextField id="rank" label="Priority (1 to 100)" inputMode="numeric" value={rank} onChange={(e) => setRank(e.target.value)} hint="When two rules match one app, the higher number wins." />
      <Button type="submit" disabled={pending || !pattern.trim()}>
        {pending ? "Adding…" : "Add rule"}
      </Button>
    </form>
  );
}

export function ArchiveCategoryButton({ id, pattern }: { id: string; pattern: string }) {
  const { run, pending } = useRun();
  const ask = useAsk();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!(await ask(`Remove the rule "${pattern}"? Days already totalled keep their numbers until they are rebuilt.`, { confirmLabel: "Remove rule", destructive: true }))) return;
        run(() => archiveCategory({ id }), () => "Rule removed.");
      }}
    >
      Remove
    </Button>
  );
}
