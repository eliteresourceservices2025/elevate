"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type Columns = { name: number | null; client: number | null; schedule: number | null; date: number | null; clockIn: number | null };
type TableStep = { headers: string[]; columns: Columns; rows: number; remembered: boolean };

const FIELDS: { key: keyof Columns; label: string; required: boolean }[] = [
  { key: "name", label: "Person's name", required: true },
  { key: "client", label: "Client", required: true },
  { key: "schedule", label: "Schedule (for example 8:00 am - 5:00 pm AZ)", required: true },
  { key: "date", label: "Date (leave empty if the sheet has none)", required: false },
  { key: "clockIn", label: "Clock-in time (a row with none is skipped)", required: false },
];

/** Step 1: choose the sheet. If it is a plain table, step 2: say which column is which. Then the sheet is read and shown as a preview. */
export function SheetUploader() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [table, setTable] = useState<TableStep | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(extra: Record<string, string>) {
    if (!file) return null;
    const form = new FormData();
    form.set("file", file);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    setBusy(true);
    try {
      const response = await fetch("/api/schedule-import/stage", { method: "POST", body: form });
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

  async function readSheet() {
    const body = await send({});
    if (!body) return;
    if (typeof body.batchId === "string") {
      router.push(`/settings/import-schedules/${body.batchId}`);
      return;
    }
    const guess = (body.guess ?? {}) as Partial<Record<keyof Columns, number>>;
    setTable({
      headers: body.headers as string[],
      rows: body.rows as number,
      remembered: body.remembered === true,
      columns: { name: guess.name ?? null, client: guess.client ?? null, schedule: guess.schedule ?? null, date: guess.date ?? null, clockIn: guess.clockIn ?? null },
    });
  }

  async function checkTable() {
    if (!table) return;
    const body = await send({ columns: JSON.stringify(table.columns) });
    if (body && typeof body.batchId === "string") router.push(`/settings/import-schedules/${body.batchId}`);
  }

  const set = (key: keyof Columns, value: string) => setTable((t) => (t ? { ...t, columns: { ...t.columns, [key]: value === "" ? null : Number(value) } } : t));
  const ready = table && table.columns.name !== null && table.columns.client !== null && table.columns.schedule !== null;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Upload an attendance sheet</h2>
      <p className="text-sm text-muted-foreground">
        The CSV or Excel sheet the team uses for attendance. ELEVATE reads who works for which client and on which schedule. It does <strong>not</strong> read worked
        hours. Nothing is changed: you get a preview to check first. The rows are kept encrypted and removed when you discard them or after 14 days. Do not include
        any client or patient information.
      </p>
      <div className="space-y-1">
        <Label htmlFor="sheet-file">CSV or Excel (.xlsx) file, up to 2 MB</Label>
        <Input
          id="sheet-file"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setTable(null);
          }}
        />
      </div>
      {!table ? (
        <Button disabled={!file || busy} onClick={readSheet}>
          Read the sheet
        </Button>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            This sheet is a plain table ({table.rows} rows, {table.headers.length} columns).{" "}
            {table.remembered ? "The columns were filled in from the last time you uploaded this layout. Check them." : "Say which column is which. It is remembered for the next upload."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`col-${f.key}`}>
                  {f.label}
                  {f.required ? " *" : ""}
                </Label>
                <NativeSelect id={`col-${f.key}`} value={table.columns[f.key] === null ? "" : String(table.columns[f.key])} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">{f.required ? "Choose a column" : "None"}</option>
                  {table.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ))}
          </div>
          <Button disabled={!ready || busy} onClick={checkTable}>
            Read the sheet with these columns
          </Button>
        </div>
      )}
    </div>
  );
}
