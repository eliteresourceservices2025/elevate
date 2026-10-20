"use client";

import { fromZonedTime } from "date-fns-tz";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useFormDialog } from "@/components/form-dialog";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/time";
import { editAttendance, loadEditableDay, type DayEvent } from "../edit-actions";
import type { FilablePerson } from "../queries";

const TYPES = [
  { key: "clock_in", label: "Clock in" },
  { key: "break_start", label: "Break start" },
  { key: "break_end", label: "Break end" },
  { key: "clock_out", label: "Clock out" },
] as const;
const TYPE_LABEL = new Map<string, string>(TYPES.map((t) => [t.key, t.label]));
const MAX_CHANGES = 6;

type Add = { type: (typeof TYPES)[number]["key"]; at: string };

/**
 * Change someone's recorded time: pick the person and the day, tick the events that were recorded wrongly (they are marked removed, never
 * deleted), add the right ones, and give a reason. HR and Super Admin save it at once; a Team Lead sends it to HR to approve.
 */
export function EditHoursForm({ people, applyNow }: { people: FilablePerson[]; applyNow: boolean }) {
  const dialog = useFormDialog();
  const [pending, start] = useTransition();
  const [find, setFind] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [day, setDay] = useState<{ zone: string; events: DayEvent[] } | null>(null);
  const [voids, setVoids] = useState<Set<string>>(new Set());
  const [adds, setAdds] = useState<Add[]>([]);
  const [reason, setReason] = useState("");

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return needle ? people.filter((p) => p.name.toLowerCase().includes(needle) || p.id === employeeId) : people;
  }, [people, find, employeeId]);

  const load = () =>
    start(async () => {
      setDay(null);
      setVoids(new Set());
      setAdds([]);
      const result = await loadEditableDay({ employeeId, date });
      if (!result.ok) return void toast.error(result.error);
      setDay(result.data);
    });

  const changes = voids.size + adds.filter((a) => a.at).length;
  const ready = Boolean(day) && changes > 0 && reason.trim().length >= 5 && adds.every((a) => a.at !== "");

  const save = () =>
    start(async () => {
      if (!day) return;
      try {
        const result = await editAttendance({
          employeeId,
          voidEventIds: [...voids],
          events: adds.map((a) => ({ type: a.type, at: fromZonedTime(a.at, day.zone).toISOString() })),
          reason,
        });
        if (!result.ok) return void toast.error(result.error);
        toast.success(result.data.applied ? "The time was changed. Their days are updated." : "Sent to HR for approval.");
        dialog?.close(true);
      } catch {
        toast.error("No connection. Try again.");
      }
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {applyNow
          ? "The change is saved at once and the person's days are rebuilt from the events that remain. A removed event stays in the record, marked as removed, with your reason. You cannot change your own time."
          : "Your change is sent to HR or Super Admin to approve; nothing changes until they do. You cannot change your own time."}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="eh-find">Find a person</Label>
          <Input id="eh-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Start typing a name" />
        </div>
        <SelectField id="eh-person" label="Person" value={employeeId} onChange={(e) => (setEmployeeId(e.target.value), setDay(null))} required>
          <option value="">Choose a person</option>
          {shown.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="eh-date">Day (in their own time zone)</Label>
          <Input id="eh-date" type="date" value={date} onChange={(e) => (setDate(e.target.value), setDay(null))} className="w-44" />
        </div>
        <Button type="button" variant="outline" disabled={pending || !employeeId || !date} onClick={load}>
          Show this day
        </Button>
      </div>

      {day ? (
        <div className="space-y-4">
          <section aria-label="Recorded events" className="space-y-2">
            <h3 className="text-sm font-semibold">Recorded events ({day.zone})</h3>
            {day.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clock events around this day. You can add some below.</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {day.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <label className="flex flex-1 items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        disabled={e.removed}
                        checked={voids.has(e.id)}
                        onChange={(ev) =>
                          setVoids((prev) => {
                            const next = new Set(prev);
                            if (ev.target.checked) next.add(e.id);
                            else next.delete(e.id);
                            return next;
                          })
                        }
                        aria-label={`Remove ${TYPE_LABEL.get(e.type) ?? e.type} at ${formatInZone(e.at, day.zone, "MMM d h:mm a")}`}
                      />
                      <span className={e.removed ? "text-muted-foreground line-through" : voids.has(e.id) ? "text-destructive line-through" : undefined}>
                        {TYPE_LABEL.get(e.type) ?? e.type} · {formatInZone(e.at, day.zone, "EEE MMM d, h:mm a")}
                      </span>
                    </label>
                    {e.removed ? <Badge variant="outline">Removed</Badge> : null}
                    {e.source === "admin_correction" && !e.removed ? <Badge variant="secondary">Corrected</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Tick an event to remove it (it was recorded by mistake).</p>
          </section>

          <section aria-label="Events to add" className="space-y-2">
            <h3 className="text-sm font-semibold">Events to add</h3>
            {adds.map((a, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <SelectField id={`eh-type-${i}`} label="Type" value={a.type} onChange={(e) => setAdds((list) => list.map((x, j) => (j === i ? { ...x, type: e.target.value as Add["type"] } : x)))}>
                  {TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </SelectField>
                <TextField id={`eh-at-${i}`} label={`When (${day.zone})`} type="datetime-local" value={a.at} onChange={(e) => setAdds((list) => list.map((x, j) => (j === i ? { ...x, at: e.target.value } : x)))} required />
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdds((list) => list.filter((_, j) => j !== i))}>
                  Remove row
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" disabled={voids.size + adds.length >= MAX_CHANGES} onClick={() => setAdds((list) => [...list, { type: "clock_in", at: "" }])}>
              Add an event
            </Button>
          </section>

          <div className="space-y-1">
            <Label htmlFor="eh-reason">Why is the time being changed?</Label>
            <Textarea id="eh-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} required />
            <p className="text-xs text-muted-foreground">Recorded with the change, and shown to the person. No client or patient information.</p>
          </div>
          <Button type="button" disabled={pending || !ready} onClick={save}>
            {applyNow ? "Save the change" : "Send for approval"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
