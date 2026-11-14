"use client";

import { useEffect, useMemo, useState } from "react";
import { FieldHint, HintedLabel } from "@/components/field-hint";
import { useFormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useRun } from "@/modules/recruiting/components/use-run";
import { createPayLine, endPayLine, removeDoubledRates, removeStoppedRates, reviewDoubledRates, updatePayLine, withdrawPayLine } from "../actions";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "../constants";
import type { DoubledGroupView, DoubledLineView } from "../doubled";
import { PAYROLL_HINTS } from "../hints";
import { sameJob } from "../lines";
import { DETAIL_REASONS, reasonText, startChoicesFor, STOP_REASONS, UPDATE_REASONS, type CutoffChoice } from "../rate-start";
import type { RateOptions, RateRow } from "../queries";
import { CutoffPicker } from "./cutoff-picker";

type Fields = {
  clientId: string;
  alias: string;
  hoursPerDay: string;
  paymentMethod: PaymentMethod;
  effectiveFrom: string;
  monthly: string;
  /** This person's own overtime percents as typed; blank = the company standard. */
  otRegular: string;
  otRestDay: string;
  otRestDayOver8: string;
};

const OT_FIELDS = [
  { field: "otRegular", label: "Regular day (%)", hint: "lineOtRegular" },
  { field: "otRestDay", label: "Rest day (%)", hint: "lineOtRestDay" },
  { field: "otRestDayOver8", label: "Rest day, past 8 hours (%)", hint: "lineOtRestDayOver8" },
] as const;

const toInput = (v: Fields) => ({
  clientId: v.clientId,
  alias: v.alias,
  hoursPerDay: Number(v.hoursPerDay),
  paymentMethod: v.paymentMethod,
  effectiveFrom: v.effectiveFrom,
  monthly: v.monthly,
  otRegular: v.otRegular,
  otRestDay: v.otRestDay,
  otRestDayOver8: v.otRestDayOver8,
});

const fieldsOf = (row: RateRow, effectiveFrom: string, monthly = row.monthly): Fields => ({
  clientId: row.clientId ?? "",
  alias: row.alias ?? "",
  hoursPerDay: String(row.hoursPerDay),
  paymentMethod: row.paymentMethod,
  effectiveFrom,
  monthly,
  otRegular: row.otPercent.regular,
  otRestDay: row.otPercent.restDay,
  otRestDayOver8: row.otPercent.restDayOver8,
});

const amount = (text: string) => Number.parseFloat(text.replace(/,/g, ""));

/** Hours, alias, payment method and the person's own overtime percents: the rarely changed details, shown on request. */
function DetailFields({ value, onChange, idPrefix, withClient }: { value: Fields; onChange: (next: Fields) => void; idPrefix: string; withClient?: RateOptions["clients"] | null }) {
  const set = <K extends keyof Fields>(key: K, v: Fields[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {withClient ? (
        <div className="space-y-1">
          <HintedLabel htmlFor={`${idPrefix}-client`} hint={PAYROLL_HINTS.lineClient}>Client (optional)</HintedLabel>
          <NativeSelect id={`${idPrefix}-client`} value={value.clientId} onChange={(e) => set("clientId", e.target.value)}>
            <option value="">No client</option>
            {withClient.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <div className="space-y-1">
        <HintedLabel htmlFor={`${idPrefix}-alias`} hint={PAYROLL_HINTS.lineAlias}>Alias (optional)</HintedLabel>
        <Input id={`${idPrefix}-alias`} value={value.alias} onChange={(e) => set("alias", e.target.value)} maxLength={80} />
      </div>
      <div className="space-y-1">
        <HintedLabel htmlFor={`${idPrefix}-hours`} hint={PAYROLL_HINTS.lineHours}>Hours per day</HintedLabel>
        <Input id={`${idPrefix}-hours`} type="number" inputMode="numeric" min={1} max={12} step={1} value={value.hoursPerDay} onChange={(e) => set("hoursPerDay", e.target.value)} required />
      </div>
      <div className="space-y-1">
        <HintedLabel htmlFor={`${idPrefix}-method`} hint={PAYROLL_HINTS.lineMethod}>Payment method</HintedLabel>
        <NativeSelect id={`${idPrefix}-method`} value={value.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
        <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
          Overtime (OT) for this person (optional)
          <FieldHint label="Overtime for this person">{PAYROLL_HINTS.lineOt}</FieldHint>
        </legend>
        {OT_FIELDS.map((f) => (
          <div key={f.field} className="space-y-1">
            <HintedLabel htmlFor={`${idPrefix}-${f.field}`} hint={PAYROLL_HINTS[f.hint]}>{f.label}</HintedLabel>
            <Input id={`${idPrefix}-${f.field}`} inputMode="decimal" value={value[f.field]} onChange={(e) => set(f.field, e.target.value)} placeholder="Standard" autoComplete="off" />
          </div>
        ))}
      </fieldset>
    </div>
  );
}

/** A quick reason to tap, with words only when "Other" is chosen. Kept in the change history, never in notices. */
function ReasonPicker({ id, picks, pick, onPick, other, onOther }: { id: string; picks: readonly string[]; pick: string; onPick: (next: string) => void; other: string; onOther: (next: string) => void }) {
  return (
    <div className="space-y-1">
      <HintedLabel htmlFor={`${id}-pick`} hint={PAYROLL_HINTS.lineReason}>Reason</HintedLabel>
      <NativeSelect id={`${id}-pick`} value={pick} onChange={(e) => onPick(e.target.value)}>
        {picks.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </NativeSelect>
      {pick === "Other" ? <Input id={`${id}-other`} aria-label="Reason, in your words" value={other} onChange={(e) => onOther(e.target.value)} maxLength={500} required /> : null}
    </div>
  );
}

const cutoffOptions = (choices: CutoffChoice[], mode: "start" | "end") => choices.map((c) => ({ value: mode === "start" ? c.start : c.end, label: c.label }));

/** Add a contractor's rate. If the person already has a rate for the same job it says so and points to Update rate instead of failing. */
export function AddContractorForm({ options, cutoffs, rows }: { options: RateOptions; cutoffs: CutoffChoice[]; rows: RateRow[] }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [employeeId, setEmployeeId] = useState("");
  const [fields, setFields] = useState<Fields>({
    clientId: "",
    alias: "",
    hoursPerDay: "8",
    paymentMethod: "remitly",
    effectiveFrom: cutoffs[0]?.start ?? "",
    monthly: "",
    otRegular: "",
    otRestDay: "",
    otRestDayOver8: "",
  });
  const set = <K extends keyof Fields>(key: K, v: Fields[K]) => setFields({ ...fields, [key]: v });
  const twin = employeeId
    ? rows.find((r) => !r.endsOn && sameJob({ employeeId: r.employeeId, clientId: r.clientId, alias: r.alias }, { employeeId, clientId: fields.clientId || null, alias: fields.alias || null }))
    : undefined;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createPayLine({ employeeId, ...toInput(fields) }), "Rate added.", () => dialog?.close(true));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <HintedLabel htmlFor="add-person" hint={PAYROLL_HINTS.linePerson}>Person</HintedLabel>
          <NativeSelect id="add-person" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
            <option value="">Choose a person</option>
            {options.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <HintedLabel htmlFor="add-client" hint={PAYROLL_HINTS.lineClient}>Client (optional)</HintedLabel>
          <NativeSelect id="add-client" value={fields.clientId} onChange={(e) => set("clientId", e.target.value)}>
            <option value="">No client</option>
            {options.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <HintedLabel htmlFor="add-monthly" hint={PAYROLL_HINTS.lineMonthly}>Monthly rate (pesos)</HintedLabel>
          <Input id="add-monthly" inputMode="decimal" value={fields.monthly} onChange={(e) => set("monthly", e.target.value)} placeholder="25,000.00" autoComplete="off" required />
        </div>
      </div>
      {twin ? (
        <Alert variant="info" role="status" className="rounded-lg p-3 text-sm">
          {twin.name} already has a rate for {twin.clientName ?? "no client"} ({twin.monthly} a month). To change it, close this window and use <strong>Update rate</strong> on that row. A second client or role gets its own rate here.
        </Alert>
      ) : null}
      <CutoffPicker
        id="add-from"
        legend="Paying from"
        hint={PAYROLL_HINTS.lineStartsOn}
        options={cutoffOptions(cutoffs, "start")}
        value={fields.effectiveFrom}
        onChange={(v) => set("effectiveFrom", v)}
      />
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">More options (hours per day, alias, payment method, overtime)</summary>
        <div className="mt-3">
          <DetailFields value={fields} onChange={setFields} idPrefix="add" />
        </div>
      </details>
      <Button type="submit" disabled={pending || !!twin || !employeeId}>
        Add contractor
      </Button>
    </form>
  );
}

/** Give the contractor a new monthly rate from a chosen cutoff. It is a new version of the same line, so it can never create a second line. */
export function UpdateRateForm({ row, cutoffs }: { row: RateRow; cutoffs: CutoffChoice[] }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const startable = startChoicesFor(cutoffs, row.effectiveFrom);
  const firstChoice = startable[0]?.start ?? row.effectiveFrom;
  const [monthly, setMonthly] = useState("");
  const [from, setFrom] = useState(firstChoice);
  const [pick, setPick] = useState<string>("Raise");
  const [other, setOther] = useState("");
  const options = cutoffOptions(startable, "start");
  if (pick === "Correction" && !options.some((o) => o.value === row.effectiveFrom)) options.push({ value: row.effectiveFrom, label: `From when it started (${row.effectiveFrom})` });
  const sameRate = monthly.trim() !== "" && amount(monthly) === amount(row.monthly);
  const reason = reasonText(pick, other);
  const choose = (next: string) => {
    setPick(next);
    if (next === "Correction") setFrom(row.effectiveFrom);
    else if (from === row.effectiveFrom) setFrom(firstChoice);
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updatePayLine({ lineKey: row.lineKey, ...toInput(fieldsOf(row, from, monthly)), reason }), "Rate updated.", () => dialog?.close(true));
      }}
    >
      <p className="text-sm text-muted-foreground">
        Current rate: <span className="font-medium text-foreground tabular-nums">{row.monthly}</span> a month, paid since {row.effectiveFrom}.
        {row.upcomingFrom ? ` A change from ${row.upcomingFrom} is already scheduled.` : ""}
      </p>
      <div className="space-y-1">
        <HintedLabel htmlFor={`upd-${row.lineKey}-monthly`} hint={PAYROLL_HINTS.lineMonthly}>New monthly rate (pesos)</HintedLabel>
        <Input id={`upd-${row.lineKey}-monthly`} inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder={row.monthly} autoComplete="off" required />
        {sameRate ? <p className="text-xs text-muted-foreground">That is the current rate.</p> : null}
      </div>
      <ReasonPicker id={`upd-${row.lineKey}`} picks={UPDATE_REASONS} pick={pick} onPick={choose} other={other} onOther={setOther} />
      <CutoffPicker
        id={`upd-${row.lineKey}-from`}
        legend="Paying the new rate from"
        hint={PAYROLL_HINTS.lineStartsOn}
        options={options}
        value={from}
        onChange={setFrom}
        note={pick === "Correction" ? "A correction can replace the rate from when it started, so the old figure is no longer used." : "Pay runs already made are not changed."}
      />
      <Button type="submit" disabled={pending || sameRate || monthly.trim() === "" || reason === "" || from === ""}>
        Update rate
      </Button>
    </form>
  );
}

/** The rarely changed details of a rate (client, alias, hours, payment method, overtime). The monthly rate itself is changed with Update rate. */
export function EditDetailsForm({ row, options, cutoffs }: { row: RateRow; options: RateOptions; cutoffs: CutoffChoice[] }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const startable = startChoicesFor(cutoffs, row.effectiveFrom);
  const firstChoice = startable[0]?.start ?? row.effectiveFrom;
  const [fields, setFields] = useState<Fields>(fieldsOf(row, firstChoice));
  const [pick, setPick] = useState<string>("Correction");
  const [other, setOther] = useState("");
  const choices = cutoffOptions(startable, "start");
  if (!choices.some((o) => o.value === row.effectiveFrom)) choices.push({ value: row.effectiveFrom, label: `From when it started (${row.effectiveFrom})` });
  const reason = reasonText(pick, other);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updatePayLine({ lineKey: row.lineKey, ...toInput(fields), reason }), "Details saved.", () => dialog?.close(true));
      }}
    >
      <DetailFields value={fields} onChange={setFields} idPrefix={`det-${row.lineKey}`} withClient={options.clients} />
      <ReasonPicker id={`det-${row.lineKey}`} picks={DETAIL_REASONS} pick={pick} onPick={setPick} other={other} onOther={setOther} />
      <CutoffPicker id={`det-${row.lineKey}-from`} legend="Applies from" hint={PAYROLL_HINTS.lineStartsOn} options={choices} value={fields.effectiveFrom} onChange={(v) => setFields({ ...fields, effectiveFrom: v })} />
      <Button type="submit" disabled={pending || reason === "" || fields.effectiveFrom === ""}>
        Save details
      </Button>
    </form>
  );
}

/** Stop paying: the last cutoff the contractor is paid for. The rate stays on record and later runs leave it out. */
export function StopPayingForm({ row, cutoffs }: { row: RateRow; cutoffs: CutoffChoice[] }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const endable = cutoffs.filter((c) => c.end >= row.effectiveFrom);
  const [last, setLast] = useState(endable[0]?.end ?? row.effectiveFrom);
  const [pick, setPick] = useState<string>(STOP_REASONS[0]);
  const [other, setOther] = useState("");
  const reason = reasonText(pick, other);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => endPayLine({ lineKey: row.lineKey, endsOn: last, reason }), "Stopped. This rate won't be on later pay runs.", () => dialog?.close(true));
      }}
    >
      <CutoffPicker
        id={`stop-${row.lineKey}-date`}
        legend="Last cutoff paid"
        hint={PAYROLL_HINTS.lineLastDay}
        options={cutoffOptions(endable, "end")}
        value={last}
        onChange={setLast}
        note="They are paid for the whole cutoff you choose. Pay runs after it leave this rate out."
      />
      <ReasonPicker id={`stop-${row.lineKey}`} picks={STOP_REASONS} pick={pick} onPick={setPick} other={other} onOther={setOther} />
      <Button type="submit" variant="destructive" disabled={pending || reason === "" || last === ""}>
        Stop paying
      </Button>
    </form>
  );
}

/** Take away a rate that was added by mistake. Only offered while it has never been on a real pay run. */
export function RemoveRateForm({ row }: { row: RateRow }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  return (
    <div className="space-y-4">
      <p className="text-sm">
        This takes {row.name}&apos;s rate for {row.clientName ?? "no client"} ({row.monthly} a month) off the Rates tab and off every draft pay run. It has never been on a real pay run. The change history keeps a record of it.
      </p>
      <p className="text-sm text-muted-foreground">If they were paid with this rate, use Stop paying instead.</p>
      <Button type="button" variant="destructive" disabled={pending} onClick={() => run(() => withdrawPayLine({ lineKey: row.lineKey, reason: "Added by mistake" }), "Rate removed.", () => dialog?.close(true))}>
        Remove this rate
      </Button>
    </div>
  );
}

const sinceText = (l: DoubledLineView) => `${l.monthly} a month, since ${l.since}${l.until ? ` to ${l.until}` : ""}${l.alias ? ` (${l.alias})` : ""}`;

/**
 * Doubled rates: the same person and client with two rates whose dates overlap, which a run pays twice. Lists each set with the newest rate
 * that stays and the ones that go (each group can be unticked: a real second role on the same client is the one exception), then removes them.
 */
export function DoubledRatesForm() {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [groups, setGroups] = useState<DoubledGroupView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let live = true;
    reviewDoubledRates()
      .then((r) => {
        if (!live) return;
        if (!r.ok) return setFailed(true);
        setGroups(r.data.groups);
        setChosen(new Set(r.data.groups.map((g) => g.groupId)));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  const toRemove = useMemo(
    () => (groups ?? []).filter((g) => chosen.has(g.groupId)).reduce((n, g) => n + g.remove.filter((r) => r.how !== "manual").length, 0),
    [groups, chosen],
  );
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Two overlapping rates for the same person and client would be paid twice. Each set below keeps the newest rate. A rate that was never on a real pay run is taken
        away; one that was paid stops the day before the newer rate starts. Nothing is deleted: the change history keeps it. The same person with a different client is never touched.
      </p>
      {failed ? (
        <Alert variant="warning" role="alert" className="rounded-lg p-3 text-sm">
          Could not check the rates. Try again.
        </Alert>
      ) : groups === null ? (
        <p className="text-sm" role="status">Checking…</p>
      ) : groups.length === 0 ? (
        <Alert variant="success" role="status" className="rounded-lg p-3 text-sm">
          No doubled rates found.
        </Alert>
      ) : (
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {groups.map((g) => (
            <li key={g.groupId} className="rounded-md border p-3 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 size-4 accent-primary" checked={chosen.has(g.groupId)} onChange={() => toggle(g.groupId)} />
                <span className="space-y-1">
                  <span className="block font-medium">
                    {g.name} · {g.clientName ?? "No client"}
                  </span>
                  <span className="block text-muted-foreground">Keeps: {sinceText(g.keep)}</span>
                  {g.remove.map((r) => (
                    <span key={r.lineKey} className="block">
                      {r.how === "withdraw" ? "Takes away" : r.how === "end" ? `Stops on ${r.endsOn}` : "Needs a manual look"}: {sinceText(r)}
                    </span>
                  ))}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        disabled={pending || toRemove === 0}
        onClick={() =>
          run(
            () => removeDoubledRates({ groupIds: [...chosen] }),
            (d) => `Done: ${d?.removed ?? 0} taken away, ${d?.stopped ?? 0} stopped${d?.manual ? `, ${d.manual} left for a manual look` : ""}. Now press Fill or update this run on any draft run.`,
            () => dialog?.close(true),
          )
        }
      >
        {toRemove === 0 ? "Remove doubled rates" : `Remove ${toRemove} doubled ${toRemove === 1 ? "rate" : "rates"}`}
      </Button>
    </div>
  );
}

/** Counts the stopped rates that were never paid, then takes them off the list. Paid ones stay: they are part of the pay history. */
export function RemoveStoppedForm() {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    removeStoppedRates({ apply: false })
      .then((r) => live && (r.ok ? setCount(r.data.count) : setFailed(true)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        This takes stopped rates off the list when they were never on a real pay run. A stopped rate that was paid stays, because it is part of the pay history.
        Nothing is deleted: the change history keeps every removed rate.
      </p>
      {failed ? (
        <Alert variant="warning" role="alert" className="rounded-lg p-3 text-sm">
          Could not count the stopped rates. Try again.
        </Alert>
      ) : count === null ? (
        <p className="text-sm" role="status">Counting…</p>
      ) : count === 0 ? (
        <Alert variant="success" role="status" className="rounded-lg p-3 text-sm">
          No stopped rates to remove.
        </Alert>
      ) : (
        <p className="text-sm font-medium" role="status">
          {count} stopped {count === 1 ? "rate" : "rates"} will be removed.
        </p>
      )}
      <Button
        type="button"
        variant="destructive"
        disabled={pending || !count}
        onClick={() => run(() => removeStoppedRates({ apply: true }), (d) => `Removed ${d?.count ?? 0} stopped ${d?.count === 1 ? "rate" : "rates"}.`, () => dialog?.close(true))}
      >
        Remove stopped rates
      </Button>
    </div>
  );
}
