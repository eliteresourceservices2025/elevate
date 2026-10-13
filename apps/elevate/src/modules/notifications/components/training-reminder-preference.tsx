"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setTrainingReminderOptOut } from "../actions";

/** One checkbox: get (or skip) emails reminding you that assigned training is due or overdue. In-app reminders are not affected. */
export function TrainingReminderPreference({ optedOut }: { optedOut: boolean }) {
  const [out, setOut] = useState(optedOut);
  const [pending, startTransition] = useTransition();
  return (
    <label htmlFor="training-reminder-pref" className="flex items-start gap-2 text-sm">
      <input
        id="training-reminder-pref"
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={!out}
        disabled={pending}
        onChange={(e) => {
          const next = !e.target.checked;
          startTransition(async () => {
            const result = await setTrainingReminderOptOut({ optOut: next });
            if (!result.ok) return void toast.error(result.error);
            setOut(next);
            toast.success(next ? "Training reminder emails turned off." : "Training reminder emails turned on.");
          });
        }}
      />
      <span>
        Email me when assigned training is coming due or overdue
        <span className="block text-xs text-muted-foreground">One email at 30 days, 7 days and the due date, then weekly while overdue. No scores or course content, only the due date and a link.</span>
      </span>
    </label>
  );
}
