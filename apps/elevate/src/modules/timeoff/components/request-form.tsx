"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { PersonPicker, type PickerOption } from "@/components/person-picker";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { formatDateOnly } from "@/lib/time";
import { formatDays } from "../ledger";
import { previewRequest, requestLeave, type RequestPreview } from "../request-actions";

type LeaveOption = { id: string; name: string; tracksBalance: boolean };

/**
 * Ask for days off. While the dates change it shows what the request would use (weekends and holidays are not
 * counted), the person's balance and who on their team is already off. With `people`, HR files it for someone else.
 */
export function RequestForm({ types, today, people }: { types: LeaveOption[]; today: string; people?: PickerOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<RequestPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const forOther = Boolean(people);
  const single = startDate !== "" && startDate === endDate;
  const invalidPerson = forOther && employeeId !== undefined && !people!.some((p) => p.id === employeeId);

  // A half day only makes sense for a single day.
  const half = halfDay && single;
  const canPreview = !forOther && Boolean(leaveTypeId) && startDate !== "" && endDate !== "" && endDate >= startDate;

  // Live preview of the days, holidays, balance and teammates off (own requests only).
  useEffect(() => {
    if (!canPreview) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewRequest({ leaveTypeId, startDate, endDate, halfDay: half });
      if (cancelled) return;
      if (result.ok) {
        setPreview(result.data);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(result.error);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canPreview, leaveTypeId, startDate, endDate, half]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await requestLeave({ leaveTypeId, startDate, endDate, halfDay: half, note, employeeId: forOther ? employeeId : undefined });
      if (!result.ok) return void toast.error(result.error);
      toast.success(forOther ? "Request filed." : "Request sent.");
      setStartDate("");
      setEndDate("");
      setNote("");
      setHalfDay(false);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-4">
      <h3 className="font-semibold">{forOther ? "File a request for someone" : "Request time off"}</h3>
      {forOther ? (
        <PersonPicker id="rq-person" label="Person" options={people!} value={employeeId} onChange={setEmployeeId} error={invalidPerson ? "Choose a person from the list" : undefined} hint="You can file for a past date. It still goes through approval." />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField id="rq-type" label="Leave type" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <TextField id="rq-start" label="First day" type="date" min={forOther ? undefined : today} value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!endDate || endDate < e.target.value) setEndDate(e.target.value); }} required />
        <TextField id="rq-end" label="Last day" type="date" min={startDate || (forOther ? undefined : today)} value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
      </div>
      <label htmlFor="rq-half" className="flex items-center gap-2 text-sm">
        <input id="rq-half" type="checkbox" className="size-4 accent-primary" checked={half} disabled={!single} onChange={(e) => setHalfDay(e.target.checked)} />
        Half day (only for a single day)
      </label>
      <TextField id="rq-note" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />

      <div aria-live="polite" className="space-y-1 text-sm">
        {canPreview && previewError ? <p className="text-destructive">{previewError}</p> : null}
        {canPreview && preview ? (
          <>
            <p>
              This uses <span className="font-semibold">{formatDays(preview.days)}</span> (weekends and holidays are not counted).
              {preview.days === 0 ? " There are no working days in that range." : ""}
            </p>
            {preview.balance ? (
              <p className={preview.days > preview.balance.available ? "text-destructive" : "text-muted-foreground"}>
                You have {formatDays(preview.balance.available)} available
                {preview.balance.reserved > 0 ? ` (${formatDays(preview.balance.reserved)} already waiting for approval)` : ""}.
              </p>
            ) : null}
            {preview.holidays.length > 0 ? (
              <p className="text-muted-foreground">
                Holidays in this range: {preview.holidays.map((h) => `${h.name} (${formatDateOnly(h.date)})`).join(", ")}.
              </p>
            ) : null}
            {preview.teammatesOff.length > 0 ? <p className="text-muted-foreground">Already off from your team: {preview.teammatesOff.join(", ")}.</p> : null}
          </>
        ) : null}
      </div>

      <Button type="submit" disabled={pending || !leaveTypeId || !startDate || !endDate || (forOther && (!employeeId || invalidPerson))}>
        {forOther ? "File request" : "Send request"}
      </Button>
    </form>
  );
}
