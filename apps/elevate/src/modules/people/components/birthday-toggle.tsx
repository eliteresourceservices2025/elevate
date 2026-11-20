"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Switch } from "@/components/ui/switch";
import { setMyBirthdayHidden } from "../birthday-actions";

/** "Show my birthday": month and day only, never the year, on colleagues' dashboards. On by default; this switches it off or back on. */
export function BirthdayToggle({ initialHidden }: { initialHidden: boolean }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(initialHidden);
  const [pending, startTransition] = useTransition();

  function change(show: boolean) {
    const next = !show;
    setHidden(next);
    startTransition(async () => {
      const result = await setMyBirthdayHidden({ hidden: next });
      if (!result.ok) {
        setHidden(!next);
        return void toast.error(result.error);
      }
      toast.success(next ? "Your birthday is hidden from the dashboard." : "Your birthday shows on the dashboard.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
      <Switch id="birthday-visible" checked={!hidden} onCheckedChange={change} disabled={pending} aria-describedby="birthday-visible-hint" />
      <div>
        <label htmlFor="birthday-visible" className="font-medium">
          Show my birthday on the dashboard
        </label>
        <p id="birthday-visible-hint" className="text-muted-foreground">
          Colleagues see your month and day, never the year.
        </p>
      </div>
    </div>
  );
}
