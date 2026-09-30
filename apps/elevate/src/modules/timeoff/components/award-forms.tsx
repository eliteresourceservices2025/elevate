"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PersonPicker, type PickerOption } from "@/components/person-picker";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { adjustBalance, awardDays } from "../actions";

type Option = { id: string; name: string };

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

const DAY_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export function AwardForm({ people, types, today, fixedEmployee }: { people: PickerOption[]; types: Option[]; today: string; fixedEmployee?: string }) {
  const { run, pending } = useRun();
  const [employeeId, setEmployeeId] = useState<string | undefined>(fixedEmployee);
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? "");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const invalidPerson = employeeId !== undefined && !people.some((p) => p.id === employeeId);

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => awardDays({ employeeId, leaveTypeId, days, reason, expiresOn }), "Prize days awarded.", () => {
          setReason("");
          setExpiresOn("");
          if (!fixedEmployee) setEmployeeId(undefined);
        });
      }}
    >
      <h3 className="font-semibold">Award prize days</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {fixedEmployee ? null : (
          <PersonPicker id="aw-person" label="Person" options={people} value={employeeId} onChange={setEmployeeId} error={invalidPerson ? "Choose a person from the list" : undefined} />
        )}
        <SelectField id="aw-type" label="Leave type" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <SelectField id="aw-days" label="Days" value={days} onChange={(e) => setDays(e.target.value)}>
          {DAY_STEPS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
        <TextField id="aw-expiry" label="Use by (optional)" type="date" min={today} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} hint="Leave empty if the days do not expire." />
      </div>
      <TextField id="aw-reason" label="Game or reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required />
      <Button type="submit" disabled={pending || !employeeId || invalidPerson || !leaveTypeId}>
        Award
      </Button>
    </form>
  );
}

export function AdjustForm({ people, types, fixedEmployee }: { people: PickerOption[]; types: Option[]; fixedEmployee?: string }) {
  const { run, pending } = useRun();
  const [employeeId, setEmployeeId] = useState<string | undefined>(fixedEmployee);
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? "");
  const [days, setDays] = useState("-1");
  const [reason, setReason] = useState("");
  const invalidPerson = employeeId !== undefined && !people.some((p) => p.id === employeeId);

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => adjustBalance({ employeeId, leaveTypeId, days, reason }), "Balance corrected.", () => setReason(""));
      }}
    >
      <h3 className="font-semibold">Correct a balance</h3>
      <p className="text-sm text-muted-foreground">For mistakes only. Use a minus sign to remove days. The balance cannot go below zero.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {fixedEmployee ? null : (
          <PersonPicker id="adj-person" label="Person" options={people} value={employeeId} onChange={setEmployeeId} error={invalidPerson ? "Choose a person from the list" : undefined} />
        )}
        <SelectField id="adj-type" label="Leave type" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <TextField id="adj-days" label="Days (+ or -)" type="number" step="0.5" min="-5" max="5" value={days} onChange={(e) => setDays(e.target.value)} required />
      </div>
      <TextField id="adj-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} required />
      <Button type="submit" variant="outline" disabled={pending || !employeeId || invalidPerson || !leaveTypeId}>
        Save correction
      </Button>
    </form>
  );
}
