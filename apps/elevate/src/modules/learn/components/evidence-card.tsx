"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { exportClientEvidence } from "../actions";

/** HR downloads the proof of training for one client on one date (CSV or PDF). Completion only: no scores. */
export function EvidenceCard({ clients, today }: { clients: { id: string; name: string; handlesPhi: boolean }[]; today: string }) {
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState("");
  const [asOf, setAsOf] = useState(today);

  const run = (format: "csv" | "pdf") =>
    start(async () => {
      try {
        const r = await exportClientEvidence({ clientId, asOf, format });
        if (!r.ok) return void toast.error(r.error);
        const bytes = r.data.base64 ? Uint8Array.from(atob(r.data.content), (c) => c.charCodeAt(0)) : null;
        const blob = new Blob([bytes ?? r.data.content], { type: r.data.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = r.data.fileName;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Downloaded: ${r.data.people} ${r.data.people === 1 ? "person" : "people"}, ${r.data.trained} trained.`);
      } catch {
        toast.error("No connection. Try again.");
      }
    });

  return (
    <section aria-label="Client evidence report" className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Client evidence report</h2>
        <p className="text-sm text-muted-foreground">
          Proof that the people assigned to a client held a current training certificate on a date. Names, certificate references and dates only: no scores or answers.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="ev-client">Client</Label>
          <NativeSelect id="ev-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-64">
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.handlesPhi ? "" : " (no patient information)"}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ev-date">As of</Label>
          <Input id="ev-date" type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} className="w-44" />
        </div>
        <Button type="button" variant="outline" disabled={pending || !clientId || !asOf} onClick={() => run("csv")}>
          {pending ? "Preparing..." : "Download CSV"}
        </Button>
        <Button type="button" disabled={pending || !clientId || !asOf} onClick={() => run("pdf")}>
          Download PDF
        </Button>
      </div>
    </section>
  );
}
