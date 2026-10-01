"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { fromZonedTime } from "date-fns-tz";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { createMyProfile } from "@/modules/people/actions";
import { cancelCorrection, decideCorrection, requestCorrection, saveClockRules, savePreferences } from "../actions";
import type { CorrectionItem, RulesRow } from "../queries";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { run, pending };
}

const ZONES = ["America/Phoenix", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Manila", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "UTC"];

export function PreferencesForm({ shareLocation, timeZone, monitoringPublished }: { shareLocation: boolean; timeZone: string | null; monitoringPublished: boolean }) {
  const { run, pending } = useRun();
  const [share, setShare] = useState(shareLocation);
  const [zone, setZone] = useState(timeZone ?? "");
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePreferences({ shareLocation: share, timeZone: zone }), "Settings saved.");
      }}
    >
      <h3 className="font-semibold">Your clock settings</h3>
      <TextField id="pf-zone" label="Your time zone" list="pf-zones" value={zone} onChange={(e) => setZone(e.target.value)} placeholder={`Company zone (${DEFAULT_TIMEZONE})`} hint="Decides which calendar day a clock-in counts for. A night shift counts for the day it started." />
      <datalist id="pf-zones">
        {ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <label htmlFor="pf-loc" className="flex items-start gap-2 text-sm">
        <input id="pf-loc" type="checkbox" className="mt-0.5 size-4 accent-primary" checked={share} disabled={!monitoringPublished && !shareLocation} onChange={(e) => setShare(e.target.checked)} />
        <span>
          Record my approximate location when I clock in
          <span className="block text-xs text-muted-foreground">
            {monitoringPublished ? "Rounded to about 1 km. Your browser asks for permission. Never required." : "Not available yet: it turns on once the monitoring policy is published."}
          </span>
        </span>
      </label>
      <Button type="submit" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

const TYPE_LABEL = new Map([["clock_in", "Clock in"], ["break_start", "Break start"], ["break_end", "Break end"], ["clock_out", "Clock out"]]);

type Preset = { key: string; label: string; fields: { type: "clock_in" | "break_start" | "break_end" | "clock_out"; label: string }[] };
const PRESETS: Preset[] = [
  { key: "out", label: "I forgot to clock out", fields: [{ type: "clock_out", label: "I stopped working at" }] },
  { key: "in", label: "I forgot to clock in", fields: [{ type: "clock_in", label: "I started working at" }] },
  {
    key: "session",
    label: "I missed a whole session",
    fields: [
      { type: "clock_in", label: "I started at" },
      { type: "clock_out", label: "I stopped at" },
    ],
  },
  { key: "break", label: "I forgot to end a break", fields: [{ type: "break_end", label: "My break ended at" }] },
];

/** Ask for missing clock events. Times are entered in the person's own zone; a lead approves; nothing existing is edited. */
export function CorrectionForm({ zone }: { zone: string }) {
  const { run, pending } = useRun();
  const [presetKey, setPresetKey] = useState("out");
  const [times, setTimes] = useState<string[]>(["", ""]);
  const [reason, setReason] = useState("");
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];

  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const events = preset.fields.map((f, i) => {
          const local = times.at(i);
          return { type: f.type, at: local ? fromZonedTime(local, zone).toISOString() : "" };
        });
        run(() => requestCorrection({ reason, events }), "Correction sent for approval.", () => {
          setTimes(["", ""]);
          setReason("");
        });
      }}
    >
      <h3 className="font-semibold">Ask for a time correction</h3>
      <p className="text-sm text-muted-foreground">Your lead approves it. Your original clock events are never changed; an approved correction adds new ones. Times are in {zone}.</p>
      <SelectField id="cr-kind" label="What happened?" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        {preset.fields.map((f, i) => (
          <TextField key={`${preset.key}-${i}`} id={`cr-at-${i}`} label={f.label} type="datetime-local" value={times.at(i) ?? ""} onChange={(e) => setTimes((t) => t.map((v, j) => (j === i ? e.target.value : v)))} required />
        ))}
      </div>
      <TextField id="cr-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
      <Button type="submit" disabled={pending}>
        Send for approval
      </Button>
    </form>
  );
}

const STATUS_VARIANT = new Map<string, "default" | "secondary" | "outline" | "destructive">([["pending", "secondary"], ["approved", "default"], ["rejected", "destructive"], ["cancelled", "outline"]]);

export function CorrectionList({ items, zone, mode, empty }: { items: CorrectionItem[]; zone: string; mode: "mine" | "queue"; empty: string }) {
  const { run, pending } = useRun();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (items.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((c) => (
        <li key={c.id} className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            {mode === "queue" ? <span className="font-semibold">{c.employeeName}</span> : null}
            <Badge variant={STATUS_VARIANT.get(c.status) ?? "outline"}>{c.status}</Badge>
            <span className="text-xs text-muted-foreground">{formatInZone(c.createdAt, zone, "MMM d, h:mm a")}</span>
          </div>
          <ul className="text-sm">
            {c.proposed.map((p, i) => (
              <li key={i}>
                {TYPE_LABEL.get(p.type) ?? p.type} at {formatInZone(p.at, zone, "MMM d, yyyy h:mm a")}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{c.reason}</p>
          {c.decisionNote ? <p className="text-sm">Note: {c.decisionNote}</p> : null}
          {mode === "queue" && c.canDecide ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`cn-${c.id}`} className="text-xs">
                  Note (needed to reject)
                </Label>
                <Input id={`cn-${c.id}`} className="w-64" maxLength={300} value={notes[c.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} />
              </div>
              <Button size="sm" disabled={pending} onClick={() => run(() => decideCorrection({ correctionId: c.id, decision: "approve", note: notes[c.id] }), "Correction approved.")}>
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideCorrection({ correctionId: c.id, decision: "reject", note: notes[c.id] }), "Correction rejected.")}>
                Reject
              </Button>
            </div>
          ) : null}
          {mode === "mine" && c.status === "pending" ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelCorrection({ correctionId: c.id }), "Request cancelled.")}>
              Cancel request
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function RulesForm({ row, monitoringPublished }: { row: RulesRow; monitoringPublished: boolean }) {
  const { run, pending } = useRun();
  const [ranges, setRanges] = useState(row.allowedCidrs.join("\n"));
  const [selfie, setSelfie] = useState(row.selfieRequired);
  const [idle, setIdle] = useState(row.idleMinutes === null ? "" : String(row.idleMinutes));
  const [grace, setGrace] = useState(String(row.graceMinutes));
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveClockRules({ teamId: row.teamId, allowedCidrs: ranges.split("\n").map((r) => r.trim()).filter(Boolean), selfieRequired: selfie, idleMinutes: idle, graceMinutes: grace }),
          `Rules saved for ${row.teamName}.`,
        );
      }}
    >
      <h3 className="font-semibold">{row.teamName}</h3>
      <div className="space-y-1.5">
        <Label htmlFor={`ranges-${row.teamId}`}>Allowed IP addresses or ranges (one per line)</Label>
        <Textarea id={`ranges-${row.teamId}`} rows={3} value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="203.0.113.0/24" />
        <p className="text-xs text-muted-foreground">Leave empty for no restriction. A clock-in from outside is flagged for the lead, never blocked.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`idle-${row.teamId}`} label="Idle prompt after (minutes)" type="number" min="5" max="240" value={idle} onChange={(e) => setIdle(e.target.value)} hint="Empty turns the prompt off." />
        <TextField id={`grace-${row.teamId}`} label="Grace after shift end (minutes)" type="number" min="0" max="240" value={grace} onChange={(e) => setGrace(e.target.value)} hint="Used once schedules exist." />
      </div>
      <label htmlFor={`selfie-${row.teamId}`} className="flex items-center gap-2 text-sm">
        <input id={`selfie-${row.teamId}`} type="checkbox" className="size-4 accent-primary" checked={selfie} disabled={!monitoringPublished && !row.selfieRequired} onChange={(e) => setSelfie(e.target.checked)} />
        Require a selfie at clock-in {monitoringPublished ? "" : "(needs the monitoring policy to be published first)"}
      </label>
      <Button type="submit" disabled={pending}>
        Save rules
      </Button>
    </form>
  );
}

/** For HR and Super Admin accounts without a people record: add themselves so they can use the clock like everyone else. */
export function SetupProfileForm() {
  const { run, pending } = useRun();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  return (
    <form
      className="max-w-xl space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createMyProfile({ firstName, lastName }), "Your profile is set up. The time clock is ready.");
      }}
    >
      <h3 className="font-semibold">Set up your profile</h3>
      <p className="text-sm text-muted-foreground">
        This adds you to the people directory with your sign-in email, so you can use the time clock, request time off and see your own data. HR can complete the rest of your details later.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="sp-first" label="Legal first name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <TextField id="sp-last" label="Legal last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
      </div>
      <Button type="submit" disabled={pending || !firstName.trim() || !lastName.trim()}>
        Set up my profile
      </Button>
    </form>
  );
}
