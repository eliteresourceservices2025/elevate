"use client";

import { useState } from "react";
import { useAsk } from "@/components/confirm-dialog";
import { useFormDialog } from "@/components/form-dialog";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/attendance/components/use-run";
import { createRelease, deleteDraftRelease, publishRelease, withdrawRelease } from "../release-actions";

/** A new draft release: the version, what changed in plain English (one change per line) and two switches. Builds come from the release script. */
export function NewReleaseForm({ policyVersions, initialAddsCollection = false }: { policyVersions: { id: string; label: string }[]; initialAddsCollection?: boolean }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [version, setVersion] = useState("");
  const [added, setAdded] = useState("");
  const [improved, setImproved] = useState("");
  const [fixed, setFixed] = useState("");
  const [minRequired, setMinRequired] = useState(false);
  const [addsCollection, setAddsCollection] = useState(initialAddsCollection);
  const [policyVersionId, setPolicyVersionId] = useState("");
  const ready = version.trim() !== "" && (added.trim() || improved.trim() || fixed.trim()) && (!addsCollection || policyVersionId !== "");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        run(
          () => createRelease({ version: version.trim(), added, improved, fixed, minRequired, addsCollection, policyVersionId: addsCollection ? policyVersionId : null }),
          () => "Draft release created. Add its builds with pnpm tracker:build, then publish it.",
          () => void dialog?.close(true),
        );
      }}
    >
      <TextField id="release-version" label="Version" value={version} onChange={(e) => setVersion(e.target.value)} required placeholder="1.2.0" hint="Three numbers with dots. It must be higher than every earlier version, and is never reused." />
      {(
        [
          ["Added", "release-added", added, setAdded],
          ["Improved", "release-improved", improved, setImproved],
          ["Fixed", "release-fixed", fixed, setFixed],
        ] as const
      ).map(([label, id, value, set]) => (
        <div key={id} className="space-y-1.5">
          <Label htmlFor={id}>{label}</Label>
          <Textarea id={id} value={value} onChange={(e) => set(e.target.value)} rows={3} />
        </div>
      ))}
      <p className="-mt-2 text-xs text-muted-foreground">Plain English, one change per line. Nothing is published until you press Publish, and a published release cannot be edited.</p>
      <div className="flex items-start gap-2">
        <Checkbox id="release-required" checked={minRequired} onCheckedChange={(v) => setMinRequired(Boolean(v))} />
        <Label htmlFor="release-required" className="font-normal">
          Required update <span className="text-muted-foreground">(older versions are refused until they update)</span>
        </Label>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="release-collection" checked={addsCollection} onCheckedChange={(v) => setAddsCollection(Boolean(v))} />
        <Label htmlFor="release-collection" className="font-normal">
          Adds new data collection <span className="text-muted-foreground">(needs a published monitoring policy version that covers it)</span>
        </Label>
      </div>
      {addsCollection ? (
        <SelectField id="release-policy" label="Monitoring policy version" value={policyVersionId} onChange={(e) => setPolicyVersionId(e.target.value)} required>
          <option value="">Choose a published version</option>
          {policyVersions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <Button type="submit" disabled={pending || !ready}>
        {pending ? "Creating…" : "Create draft"}
      </Button>
    </form>
  );
}

export function PublishButton({ id, version }: { id: string; version: string }) {
  const { run, pending } = useRun();
  const ask = useAsk();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!(await ask(`Publish version ${version}? It cannot be edited afterwards, and everyone sees its notes on the download page.`, { confirmLabel: "Publish" }))) return;
        run(() => publishRelease({ id }), () => `Version ${version} published.`);
      }}
    >
      Publish
    </Button>
  );
}

export function WithdrawButton({ id, version }: { id: string; version: string }) {
  const { run, pending } = useRun();
  const ask = useAsk();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!(await ask(`Withdraw version ${version}? People stop being offered it, and the previous version is offered again.`, { confirmLabel: "Withdraw", destructive: true }))) return;
        run(() => withdrawRelease({ id }), () => `Version ${version} withdrawn.`);
      }}
    >
      Withdraw
    </Button>
  );
}

export function DeleteDraftButton({ id, version }: { id: string; version: string }) {
  const { run, pending } = useRun();
  const ask = useAsk();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!(await ask(`Delete the draft of version ${version}? Its uploaded builds are removed too.`, { confirmLabel: "Delete draft", destructive: true }))) return;
        run(() => deleteDraftRelease({ id }), () => "Draft deleted.");
      }}
    >
      Delete draft
    </Button>
  );
}
