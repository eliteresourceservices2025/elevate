"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { DESTINATIONS } from "../mapping";

type Step = { headers: string[]; mapping: Record<string, string>; rows: number };

/** Step 1: choose the CSV. Step 2: check where each column goes and the date format. Step 3: the file is checked and shown as a preview. */
export function ImportUploader() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [dateFormat, setDateFormat] = useState("mdy");
  const [busy, setBusy] = useState(false);

  async function send(extra: Record<string, string>) {
    if (!file) return null;
    const form = new FormData();
    form.set("file", file);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    setBusy(true);
    try {
      const response = await fetch("/api/imports/stage", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as ({ ok: boolean; error?: string } & Record<string, unknown>) | null;
      if (!body?.ok) {
        toast.error(body?.error ?? "Something went wrong. Please try again.");
        return null;
      }
      return body;
    } catch {
      toast.error("No connection. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function readFile() {
    const body = await send({});
    if (body) setStep({ headers: body.headers as string[], mapping: body.mapping as Record<string, string>, rows: body.rows as number });
  }

  async function check() {
    if (!step) return;
    const body = await send({ mapping: JSON.stringify(step.mapping), dateFormat });
    if (body) router.push(`/settings/import/${body.batchId as string}`);
  }

  const setDest = (header: string, value: string) => setStep((s) => (s ? { ...s, mapping: { ...s.mapping, [header]: value } } : s));

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Upload a TalentHR export</h2>
      <p className="text-sm text-muted-foreground">
        The CSV or Excel export from TalentHR (Settings, Import and Export). Only the first sheet of an Excel file is read. Nothing is created yet: the file is checked and shown as a preview first. It is kept encrypted and removed once you commit or discard it.
      </p>
      <div className="space-y-1">
        <Label htmlFor="import-file">CSV or Excel (.xlsx) file, up to 2 MB</Label>
        <Input
          id="import-file"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setStep(null);
          }}
        />
      </div>
      {!step ? (
        <Button disabled={!file || busy} onClick={readFile}>
          Read the file
        </Button>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            {step.rows} rows, {step.headers.length} columns. Check where each column goes. Columns left as &ldquo;Do not import&rdquo; are never saved.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Column in the file</th>
                  <th className="p-2">Goes to</th>
                </tr>
              </thead>
              <tbody>
                {step.headers.map((h, i) => {
                  const dest = step.mapping[h] ?? "ignore";
                  const isCustom = dest.startsWith("custom:");
                  return (
                    <tr key={h} className="border-b last:border-0">
                      <td className="p-2 align-top">
                        <Label htmlFor={`map-${i}`}>{h}</Label>
                      </td>
                      <td className="space-y-1 p-2">
                        <NativeSelect id={`map-${i}`} value={isCustom ? "custom" : dest} onChange={(e) => setDest(h, e.target.value === "custom" ? `custom:${h.replace(/^custom_fields:/i, "")}` : e.target.value)}>
                          {DESTINATIONS.map((d) => (
                            <option key={d.value} value={d.value}>
                              {d.label}
                            </option>
                          ))}
                          <option value="custom">HR-only custom field…</option>
                        </NativeSelect>
                        {isCustom ? (
                          <div className="space-y-1">
                            <Label htmlFor={`map-name-${i}`} className="text-xs">
                              Custom field name (never use this for sensitive information)
                            </Label>
                            <Input id={`map-name-${i}`} value={dest.slice(7)} maxLength={60} onChange={(e) => setDest(h, `custom:${e.target.value}`)} />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="max-w-xs space-y-1">
            <Label htmlFor="import-dates">Dates in the file look like</Label>
            <NativeSelect id="import-dates" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              <option value="mdy">Month/Day/Year (06/30/2026)</option>
              <option value="dmy">Day/Month/Year (30/06/2026)</option>
              <option value="iso">Year-Month-Day (2026-06-30)</option>
            </NativeSelect>
          </div>
          <Button disabled={busy} onClick={check}>
            Check the file
          </Button>
        </div>
      )}
    </div>
  );
}
