"use client";

import { useState } from "react";
import { PersonPicker, type PickerOption } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRun } from "@/modules/recruiting/components/use-run";
import { addCredential, importCredentials, removeCredential, type ImportSummary } from "../actions";

const box = "space-y-3 rounded-xl border bg-card p-4";

/** HR records one certificate by hand. */
export function AddCredentialForm({ people }: { people: PickerOption[] }) {
  const { run, pending } = useRun();
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [name, setName] = useState("HIPAA Awareness certificate");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  return (
    <form
      className={box}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addCredential({ employeeId, name, issuedOn, expiresOn }), "Certificate recorded.", () => {
          setIssuedOn("");
          setExpiresOn("");
        });
      }}
    >
      <h2 className="text-lg font-semibold">Add a certificate</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <PersonPicker id="cred-person" label="Person" options={people} value={employeeId} onChange={setEmployeeId} />
        <div className="space-y-1">
          <Label htmlFor="cred-name">Certificate</Label>
          <Input id="cred-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cred-issued">Issued on (optional)</Label>
          <Input id="cred-issued" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cred-ends">Ends on</Label>
          <Input id="cred-ends" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} required />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Only the name and dates are kept here. Do not add certificate numbers, scores or prices.</p>
      <Button type="submit" disabled={pending || !employeeId}>
        Add certificate
      </Button>
    </form>
  );
}

/** Takes a certificate off the list (it is archived, not erased). */
export function RemoveCredentialButton({ id, label }: { id: string; label: string }) {
  const { run, pending } = useRun();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={`Remove ${label}`}
      onClick={() => window.confirm("Remove this certificate from the list? Use this for one entered by mistake.") && run(() => removeCredential({ credentialId: id }), "Certificate removed.")}
    >
      Remove
    </Button>
  );
}

/** Loads certificates from TalentHR's assets file: preview first, then confirm. The file is read in the browser and sent as text. */
export function ImportCredentialsCard() {
  const { run, pending } = useRun();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [nameContains, setNameContains] = useState("HIPAA");
  const [result, setResult] = useState<ImportSummary | null>(null);

  const go = (commit: boolean) =>
    run<ImportSummary>(
      () => importCredentials({ csv, nameContains, commit }),
      (d) => (commit ? `Loaded ${d?.created ?? 0} certificates.` : ""),
      (d) => setResult(d ?? null),
    );

  return (
    <section aria-label="Load from TalentHR" className={box}>
      <h2 className="text-lg font-semibold">Load from TalentHR</h2>
      <p className="text-sm text-muted-foreground">
        Upload TalentHR&apos;s assets file (CSV). Rows whose name contains the text below and that are assigned to a person with an end date (Warranty end
        date) become certificates. Prices and everything else are ignored. Import the people first, because people are matched by email.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="imp-file">Assets file (CSV)</Label>
          <Input
            id="imp-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setResult(null);
              if (!f) return setCsv("");
              setFileName(f.name);
              setCsv(await f.text());
            }}
          />
          {fileName ? <p className="text-xs text-muted-foreground">{fileName} chosen</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="imp-name">Certificate name contains</Label>
          <Input id="imp-name" value={nameContains} onChange={(e) => { setNameContains(e.target.value); setResult(null); }} maxLength={60} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending || !csv} onClick={() => go(false)}>
          Preview
        </Button>
        <Button type="button" disabled={pending || !csv || !result || result.committed || result.created === 0} onClick={() => go(true)}>
          Load {result && !result.committed ? result.created : ""} certificates
        </Button>
      </div>

      {result ? (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm" aria-live="polite">
          <p className="font-medium">{result.committed ? "Loaded." : "Preview, nothing saved yet."}</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>{result.looked} rows in the file match the name.</li>
            <li>
              {result.created} {result.committed ? "certificates were created" : "would be created"}.
            </li>
            <li>{result.alreadyThere} were already recorded.</li>
            <li>{result.skipped.length} were skipped.</li>
          </ul>
          {result.skipped.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-muted-foreground">Why rows were skipped</summary>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {Object.entries(
                  result.skipped.reduce<Record<string, number[]>>((acc, s) => ((acc[s.reason] ??= []).push(s.row), acc), {}),
                ).map(([reason, rows]) => (
                  <li key={reason}>
                    {reason}: {rows.length} (rows {rows.slice(0, 12).join(", ")}
                    {rows.length > 12 ? ", …" : ""})
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
