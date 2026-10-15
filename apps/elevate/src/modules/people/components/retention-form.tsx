"use client";

import { useState } from "react";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { useRun } from "@/modules/recruiting/components/use-run";
import { savePeopleRetention } from "../retention-actions";

export function PeopleRetentionForm({ initial }: { initial: { enabled: boolean; archiveAfterMonths: number; anonymizeAfterMonths: number } }) {
  const { run, pending } = useRun();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [archive, setArchive] = useState(String(initial.archiveAfterMonths));
  const [anonymize, setAnonymize] = useState(String(initial.anonymizeAfterMonths));
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePeopleRetention({ enabled, archiveAfterMonths: Number(archive), anonymizeAfterMonths: Number(anonymize) }), "Retention settings saved.");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="pr-archive" label="Months after the end date until the HR-only archive" type="number" min={12} max={240} value={archive} onChange={(e) => setArchive(e.target.value)} />
        <TextField id="pr-anon" label="Months after the end date until personal data is anonymized" type="number" min={13} max={240} value={anonymize} onChange={(e) => setAnonymize(e.target.value)} />
      </div>
      <label htmlFor="pr-on" className="flex items-center gap-2 text-sm">
        <input id="pr-on" type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Run the nightly retention job
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
    </form>
  );
}
