"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setDigestOptOut } from "../actions";

/** One checkbox: get (or skip) the weekday summary email. Emails about something you must acknowledge always come. */
export function DigestPreference({ optedOut }: { optedOut: boolean }) {
  const [out, setOut] = useState(optedOut);
  const [pending, startTransition] = useTransition();
  return (
    <label htmlFor="digest-pref" className="flex items-start gap-2 text-sm">
      <input
        id="digest-pref"
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={!out}
        disabled={pending}
        onChange={(e) => {
          const next = !e.target.checked;
          startTransition(async () => {
            const result = await setDigestOptOut({ optOut: next });
            if (!result.ok) return void toast.error(result.error);
            setOut(next);
            toast.success(next ? "Daily summary email turned off." : "Daily summary email turned on.");
          });
        }}
      />
      <span>
        Email me a weekday summary of my unread notifications
        <span className="block text-xs text-muted-foreground">Counts only, no details. Emails about something you must acknowledge are always sent.</span>
      </span>
    </label>
  );
}
