"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { archiveHoliday, archiveLeaveType, createHoliday, createLeaveType, updateHoliday, updateLeaveType } from "../actions";
import type { HolidayRow, LeaveTypeRow } from "../queries";

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

const box = (id: string, label: string, checked: boolean, set: (v: boolean) => void, disabled = false) => (
  <label htmlFor={id} className="flex items-center gap-2 text-sm">
    <input id={id} type="checkbox" className="size-4 accent-primary" checked={checked} disabled={disabled} onChange={(e) => set(e.target.checked)} />
    {label}
  </label>
);

// --- Leave types -----------------------------------------------------------------------------

export function NewLeaveTypeForm() {
  const { run, pending } = useRun();
  const [name, setName] = useState("");
  const [tracksBalance, setTracksBalance] = useState(true);
  const [skipHr, setSkipHr] = useState(false);
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createLeaveType({ name, tracksBalance, skipHr }), "Leave type added.", () => setName(""));
      }}
    >
      <TextField id="lt-name" label="New leave type" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {box("lt-tracks", "Draws from a balance of awarded days", tracksBalance, setTracksBalance)}
        {box("lt-skip", "Skip HR's final approval", skipHr, setSkipHr)}
      </div>
      <Button type="submit" disabled={pending || name.trim().length < 2}>
        Add type
      </Button>
    </form>
  );
}

export function LeaveTypeRowForm({ type }: { type: LeaveTypeRow }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);
  const [skipHr, setSkipHr] = useState(type.skipHr);

  if (!editing)
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{type.name}</span>
          <Badge variant="outline">{type.tracksBalance ? "Has a balance" : "No balance"}</Badge>
          {type.skipHr ? <Badge variant="secondary">Skips HR approval</Badge> : null}
          {type.archived ? <Badge variant="secondary">Retired</Badge> : null}
        </div>
        {type.archived ? null : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => window.confirm(`Retire "${type.name}"? It disappears from new awards. Existing entries stay.`) && run(() => archiveLeaveType({ leaveTypeId: type.id }), "Leave type retired.")}>
              Retire
            </Button>
          </div>
        )}
      </li>
    );

  return (
    <li className="py-3">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateLeaveType({ leaveTypeId: type.id, name, skipHr }), "Leave type updated.", () => setEditing(false));
        }}
      >
        <TextField id={`lt-name-${type.id}`} label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        {box(`lt-skip-${type.id}`, "Skip HR's final approval", skipHr, setSkipHr)}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </li>
  );
}

// --- Holidays --------------------------------------------------------------------------------

export const HOLIDAY_KIND_LABELS: Record<string, string> = {
  regular: "Regular holiday",
  special_non_working: "Special non-working day",
  special_working: "Special working day",
  federal: "Federal holiday",
  observed: "Observed",
  other: "Other",
};
const KINDS = Object.keys(HOLIDAY_KIND_LABELS);

function HolidayFields({ id, calendar, setCalendar, date, setDate, name, setName, kind, setKind, verified, setVerified, lockCalendar }: {
  id: string;
  calendar: "PH" | "US"; setCalendar: (v: "PH" | "US") => void;
  date: string; setDate: (v: string) => void;
  name: string; setName: (v: string) => void;
  kind: string; setKind: (v: string) => void;
  verified: boolean; setVerified: (v: boolean) => void;
  lockCalendar?: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <SelectField id={`${id}-cal`} label="Calendar" value={calendar} disabled={lockCalendar} onChange={(e) => setCalendar(e.target.value as "PH" | "US")}>
          <option value="PH">Philippines</option>
          <option value="US">United States</option>
        </SelectField>
        <TextField id={`${id}-date`} label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <TextField id={`${id}-name`} label="Holiday" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        <SelectField id={`${id}-kind`} label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            // eslint-disable-next-line security/detect-object-injection -- k comes from Object.keys of the same object
            <option key={k} value={k}>{HOLIDAY_KIND_LABELS[k]}</option>
          ))}
        </SelectField>
      </div>
      {box(`${id}-verified`, "Checked against the official calendar", verified, setVerified)}
    </>
  );
}

export function NewHolidayForm({ defaultDate }: { defaultDate: string }) {
  const { run, pending } = useRun();
  const [calendar, setCalendar] = useState<"PH" | "US">("PH");
  const [date, setDate] = useState(defaultDate);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("regular");
  const [verified, setVerified] = useState(true);
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createHoliday({ calendar, date, name, kind, verified }), "Holiday added.", () => setName(""));
      }}
    >
      <h3 className="font-semibold">Add a holiday</h3>
      <HolidayFields id="nh" {...{ calendar, setCalendar, date, setDate, name, setName, kind, setKind, verified, setVerified }} />
      <Button type="submit" disabled={pending || !name.trim() || !date}>
        Add holiday
      </Button>
    </form>
  );
}

/** HR controls on one holiday row: mark checked, edit, remove. */
export function HolidayControls({ holiday }: { holiday: HolidayRow }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState(false);
  const [calendar, setCalendar] = useState(holiday.calendar);
  const [date, setDate] = useState(holiday.date);
  const [name, setName] = useState(holiday.name);
  const [kind, setKind] = useState(holiday.kind);
  const [verified, setVerified] = useState(holiday.verified);

  if (!editing)
    return (
      <div className="flex justify-end gap-1">
        {holiday.verified ? null : (
          <Button variant="ghost" size="xs" disabled={pending} onClick={() => run(() => updateHoliday({ holidayId: holiday.id, calendar: holiday.calendar, date: holiday.date, name: holiday.name, kind: holiday.kind, verified: true }), "Marked as checked.")}>
            Mark checked
          </Button>
        )}
        <Button variant="ghost" size="xs" onClick={() => setEditing(true)} aria-label={`Edit ${holiday.name}`}>
          Edit
        </Button>
        <Button variant="ghost" size="xs" disabled={pending} aria-label={`Remove ${holiday.name}`} onClick={() => window.confirm(`Remove "${holiday.name}" (${holiday.date}) from the calendar?`) && run(() => archiveHoliday({ holidayId: holiday.id }), "Holiday removed.")}>
          Remove
        </Button>
      </div>
    );

  return (
    <form
      className="space-y-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateHoliday({ holidayId: holiday.id, calendar, date, name, kind, verified }), "Holiday updated.", () => setEditing(false));
      }}
    >
      <HolidayFields id={`eh-${holiday.id}`} {...{ calendar, setCalendar, date, setDate, name, setName, kind, setKind, verified, setVerified }} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
