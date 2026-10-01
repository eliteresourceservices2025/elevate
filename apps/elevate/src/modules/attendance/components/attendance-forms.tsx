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
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { createMyProfile } from "@/modules/people/actions";
import { cancelCorrection, decideCorrection, fileCorrectionForOthers, openEvidence, requestCorrection, requestEvidenceUpload, saveClockRules, savePreferences, saveShiftNote } from "../actions";
import { EOD_TEMPLATE } from "../clock";
import type { CorrectionItem, FilablePerson, RulesRow } from "../queries";

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

const KINDS = [
  { key: "forgot", label: "I forgot" },
  { key: "connection_problem", label: "My internet connection dropped" },
  { key: "device_problem", label: "My device restarted or failed" },
  { key: "other", label: "Something else" },
] as const;
const KIND_LABEL = new Map<string, string>(KINDS.map((k) => [k.key, k.label]));
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5_000_000;
const LOCAL = "yyyy-MM-dd'T'HH:mm";

/** Ask for missing clock events. Times are entered in the person's own zone; a lead approves; nothing existing is edited. A claim that adds a clock-in needs a screenshot. */
export function CorrectionForm({ zone }: { zone: string }) {
  const { run, pending } = useRun();
  const [presetKey, setPresetKey] = useState("out");
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("forgot");
  const [times, setTimes] = useState<string[]>(["", ""]);
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
  const needsProof = preset.fields.some((f) => f.type === "clock_in");

  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const events = preset.fields.map((f, i) => {
          const local = times.at(i);
          return { type: f.type, at: local ? fromZonedTime(local, zone).toISOString() : "" };
        });
        run(
          async () => {
            const evidenceIds: string[] = [];
            for (const f of files) {
              const ticket = await requestEvidenceUpload({ mime: f.type, size: f.size });
              if (!ticket.ok) return ticket;
              const { error } = await createSupabaseBrowserClient().storage.from("employee-docs").uploadToSignedUrl(ticket.data.path, ticket.data.token, f, { contentType: f.type });
              if (error) return { ok: false as const, error: "A screenshot did not upload. Try again." };
              evidenceIds.push(ticket.data.id);
            }
            return requestCorrection({ reason, kind, events, evidenceIds });
          },
          "Correction sent for approval.",
          () => {
            setTimes(["", ""]);
            setReason("");
            setFiles([]);
          },
        );
      }}
    >
      <h3 className="font-semibold">Ask for a time correction</h3>
      <p className="text-sm text-muted-foreground">Your lead approves it. Your original clock events are never changed; an approved correction adds new ones. Times are in {zone}.</p>
      <SelectField id="cr-kind" label="What do you need to add?" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </SelectField>
      <SelectField id="cr-why" label="Why?" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        {KINDS.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        {preset.fields.map((f, i) => (
          <TextField key={`${preset.key}-${i}`} id={`cr-at-${i}`} label={f.label} type="datetime-local" value={times.at(i) ?? ""} onChange={(e) => setTimes((t) => t.map((v, j) => (j === i ? e.target.value : v)))} required />
        ))}
      </div>
      <TextField id="cr-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
      <div className="space-y-1.5">
        <Label htmlFor="cr-files">Screenshots as proof{needsProof ? " (required)" : " (optional)"}</Label>
        <Input
          id="cr-files"
          type="file"
          accept="image/jpeg,image/png"
          multiple
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []).slice(0, MAX_FILES);
            if ((e.target.files?.length ?? 0) > MAX_FILES) toast.error(`Attach ${MAX_FILES} screenshots at most.`);
            const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
            if (tooBig) {
              toast.error("Each screenshot must be 5 MB or smaller.");
              e.target.value = "";
              return setFiles([]);
            }
            setFiles(picked);
          }}
        />
        <p className="text-xs text-muted-foreground">
          A screenshot of your browser history that shows when you started, a JPG or PNG up to 5 MB, three at most. Crop it to the times and sites.{" "}
          <strong>Never include client or patient information.</strong> Only you, your leads and HR can open it, and it is deleted 90 days after the decision.
        </p>
      </div>
      <Button type="submit" disabled={pending || (needsProof && files.length === 0)}>
        Send for approval
      </Button>
    </form>
  );
}

/** A lead (their team) or HR (anyone) files a correction for someone else. HR decides it; the person is told. */
export function FileForOthersForm({ people, zone }: { people: FilablePerson[]; zone: string }) {
  const { run, pending } = useRun();
  const [who, setWho] = useState("");
  const [presetKey, setPresetKey] = useState("out");
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("device_problem");
  const [times, setTimes] = useState<string[]>(["", ""]);
  const [reason, setReason] = useState("");
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
  if (people.length === 0) return null;
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const events = preset.fields.map((f, i) => {
          const local = times.at(i);
          return { type: f.type, at: local ? fromZonedTime(local, zone).toISOString() : "" };
        });
        run(() => fileCorrectionForOthers({ employeeId: who, reason, kind, events }), "Correction filed. The person was told and HR will decide.", () => {
          setTimes(["", ""]);
          setReason("");
        });
      }}
    >
      <h3 className="font-semibold">File a correction for someone</h3>
      <p className="text-sm text-muted-foreground">For when their device is down or they cannot sign in. They are told, and HR decides it (not you). Times are in {zone}.</p>
      <SelectField id="fo-who" label="Person" value={who} onChange={(e) => setWho(e.target.value)} required>
        <option value="">Choose a person</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField id="fo-kind" label="What to add" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </SelectField>
        <SelectField id="fo-why" label="Why?" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {preset.fields.map((f, i) => (
          <TextField key={`${preset.key}-${i}`} id={`fo-at-${i}`} label={f.label} type="datetime-local" value={times.at(i) ?? ""} onChange={(e) => setTimes((t) => t.map((v, j) => (j === i ? e.target.value : v)))} required />
        ))}
      </div>
      <TextField id="fo-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
      <Button type="submit" disabled={pending || !who}>
        File correction
      </Button>
    </form>
  );
}

const STATUS_VARIANT = new Map<string, "default" | "secondary" | "outline" | "destructive">([["pending", "secondary"], ["approved", "default"], ["rejected", "destructive"], ["cancelled", "outline"]]);

export function CorrectionList({ items, zone, mode, empty }: { items: CorrectionItem[]; zone: string; mode: "mine" | "queue"; empty: string }) {
  const { run, pending } = useRun();
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** Local times the reviewer typed to change a request before approving it. */
  const [adjust, setAdjust] = useState<Record<string, string[]>>({});
  const open = async (evidenceId: string) => {
    const result = await openEvidence({ evidenceId });
    if (!result.ok) return void toast.error(result.error);
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  };
  if (items.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((c) => (
        <li key={c.id} className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            {mode === "queue" ? <span className="font-semibold">{c.employeeName}</span> : null}
            <Badge variant={STATUS_VARIANT.get(c.status) ?? "outline"}>{c.status}</Badge>
            <Badge variant="outline">{KIND_LABEL.get(c.kind) ?? c.kind}</Badge>
            {c.hrOnly && c.status === "pending" ? <Badge variant="secondary">HR decides</Badge> : null}
            <span className="text-xs text-muted-foreground">{formatInZone(c.createdAt, zone, "MMM d, h:mm a")}</span>
          </div>
          <ul className="text-sm">
            {c.proposed.map((p, i) => (
              <li key={i}>
                {TYPE_LABEL.get(p.type) ?? p.type} at {formatInZone(p.at, zone, "MMM d, yyyy h:mm a")}
              </li>
            ))}
          </ul>
          {c.originalProposed ? (
            <p className="text-xs text-muted-foreground">
              The reviewer changed the times. First asked: {c.originalProposed.map((p) => `${TYPE_LABEL.get(p.type) ?? p.type} ${formatInZone(p.at, zone, "MMM d, h:mm a")}`).join(", ")}.
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{c.reason}</p>
          {c.filedBy ? <p className="text-xs text-muted-foreground">Filed for them by {c.filedBy}.</p> : null}
          {c.evidence.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {c.evidence.map((ev, i) =>
                ev.purged ? (
                  <span key={ev.id} className="text-xs text-muted-foreground">
                    Screenshot {i + 1} was deleted after 90 days
                  </span>
                ) : (
                  <Button key={ev.id} size="sm" variant="outline" onClick={() => void open(ev.id)}>
                    View screenshot {i + 1}
                  </Button>
                ),
              )}
            </div>
          ) : null}
          {c.decisionNote ? <p className="text-sm">Note: {c.decisionNote}</p> : null}
          {mode === "queue" && c.canDecide ? (
            <div className="space-y-2">
              {adjust[c.id] ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {c.proposed.map((p, i) => (
                    <div key={i} className="space-y-1">
                      <Label htmlFor={`ca-${c.id}-${i}`} className="text-xs">
                        {TYPE_LABEL.get(p.type) ?? p.type} (change if needed)
                      </Label>
                      <Input id={`ca-${c.id}-${i}`} type="datetime-local" value={(adjust[c.id] ?? []).at(i) ?? ""} onChange={(e) => setAdjust((a) => ({ ...a, [c.id]: a[c.id].map((v, j) => (j === i ? e.target.value : v)) }))} />
                    </div>
                  ))}
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setAdjust((a) => ({ ...a, [c.id]: c.proposed.map((p) => formatInZone(p.at, zone, LOCAL)) }))}>
                  Change the times
                </Button>
              )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`cn-${c.id}`} className="text-xs">
                  Note (needed to reject)
                </Label>
                <Input id={`cn-${c.id}`} className="w-64" maxLength={300} value={notes[c.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} />
              </div>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  const edited = adjust[c.id];
                  const events = edited ? c.proposed.map((p, i) => ({ type: p.type, at: edited.at(i) ? fromZonedTime(edited.at(i)!, zone).toISOString() : "" })) : undefined;
                  run(() => decideCorrection({ correctionId: c.id, decision: "approve", note: notes[c.id], events }), "Correction approved.");
                }}
              >
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideCorrection({ correctionId: c.id, decision: "reject", note: notes[c.id] }), "Correction rejected.")}>
                Reject
              </Button>
            </div>
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
  const [eod, setEod] = useState(row.eodExpected);
  const [jibble, setJibble] = useState(row.jibbleMirror);
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveClockRules({ teamId: row.teamId, allowedCidrs: ranges.split("\n").map((r) => r.trim()).filter(Boolean), selfieRequired: selfie, idleMinutes: idle, graceMinutes: grace, eodExpected: eod, jibbleMirror: jibble }),
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
      <label htmlFor={`jibble-${row.teamId}`} className="flex items-start gap-2 text-sm">
        <input id={`jibble-${row.teamId}`} type="checkbox" className="mt-0.5 size-4 accent-primary" checked={jibble} disabled={!monitoringPublished && !row.jibbleMirror} onChange={(e) => setJibble(e.target.checked)} />
        <span>
          Mirror the clock to Jibble (screenshots)
          <span className="block text-xs text-muted-foreground">{monitoringPublished ? "Jibble's screenshot app runs while ELEVATE says the person is working. See the Jibble tab." : "Needs the monitoring policy to be published first."}</span>
        </span>
      </label>
      <label htmlFor={`eod-${row.teamId}`} className="flex items-center gap-2 text-sm">
        <input id={`eod-${row.teamId}`} type="checkbox" className="size-4 accent-primary" checked={eod} onChange={(e) => setEod(e.target.checked)} />
        Expect an end-of-day report (a missing one is flagged; it never blocks clocking out)
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

/** One session's end-of-day note: shown with an Edit button while the 24 hours are open, or an Add button. */
export function ShiftNote({ sessionId, initial, edited, canEdit }: { sessionId: string; initial: string | null; edited: boolean; canEdit: boolean }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(initial ?? "");
  if (!editing) {
    return (
      <div className="space-y-1">
        {initial ? (
          <p className="whitespace-pre-wrap text-sm">
            {initial}
            {edited ? <span className="ml-1 text-xs text-muted-foreground">(edited)</span> : null}
          </p>
        ) : null}
        {canEdit ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {initial ? "Edit note" : "Add end-of-day note"}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveShiftNote({ sessionId, body }), "Note saved.", () => setEditing(false));
      }}
    >
      <Label htmlFor={`note-${sessionId}`} className="text-xs">
        End-of-day note (never include client or patient information)
      </Label>
      <Textarea id={`note-${sessionId}`} rows={6} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={pending || !body.trim()}>
          Save note
        </Button>
        <Button size="sm" type="button" variant="outline" onClick={() => setBody((b) => (b.trim() ? b : EOD_TEMPLATE))}>
          Use template
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
