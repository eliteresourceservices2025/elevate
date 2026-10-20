"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRY_OPTIONS, PH_PROVINCES, US_STATES, addressLabels, phCitiesFor } from "../address-data";

export type AddressValue = {
  addressLine?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
};

type Errors = Partial<Record<keyof AddressValue, string | undefined>>;
type Option = { value: string; label: string };

/** The saved value when it is not one of the choices, kept selectable so an old address can stay as it is. */
const withCurrent = (options: Option[], value: string | undefined): Option[] =>
  value && !options.some((o) => o.value === value) ? [{ value, label: `(current) ${value}` }, ...options] : options;

function OptionPicker({ id, label, value, options, onChange, error, disabled, hint, searchLabel }: {
  id: string;
  label: string;
  value: string | undefined;
  options: Option[];
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  hint?: string;
  searchLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = withCurrent(options, value);
  const selected = shown.find((o) => o.value === value);

  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          type="button"
          disabled={disabled}
          aria-label={label}
          aria-expanded={open}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30"
        >
          <span className={selected ? "truncate" : "truncate text-muted-foreground"}>{selected?.label ?? "Not set"}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] max-h-[min(22rem,var(--available-height))] p-0">
          <Command>
            <CommandInput autoFocus aria-label={searchLabel} placeholder={`${searchLabel}...`} />
            <CommandList>
              <CommandEmpty>Nothing found.</CommandEmpty>
              {shown.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => { onChange(o.value); setOpen(false); }}>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.value === value ? <Check className="size-4 shrink-0" aria-label="Selected" /> : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {hint && !error ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function FreeField({ id, label, value, onChange, error, hint, ...rest }: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
} & Pick<ComponentProps<typeof Input>, "inputMode" | "maxLength" | "autoComplete">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
      {hint && !error ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

const US_OPTIONS: Option[] = US_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));
const PH_PROVINCE_OPTIONS: Option[] = PH_PROVINCES.map((p) => ({ value: p, label: p }));
const COUNTRY_PICK: Option[] = COUNTRY_OPTIONS.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }));

/**
 * Address inputs that follow the country: United States (state list, ZIP), Philippines (province and city lists from PSGC,
 * 4-digit postal code) and free text for anywhere else. Controlled: the form keeps the values and receives each change.
 * Choosing another country clears province and city, because the old ones would no longer fit.
 */
export function AddressFields({ idPrefix, value, onChange, errors = {} }: {
  idPrefix: string;
  value: AddressValue;
  onChange: (patch: Partial<AddressValue>) => void;
  errors?: Errors;
}) {
  const country = value.country || "PH";
  const labels = addressLabels(country);
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <>
      <OptionPicker
        id={id("country")}
        label="Country"
        value={country}
        options={COUNTRY_PICK}
        searchLabel="Search countries"
        error={errors.country}
        onChange={(next) => onChange(next === country ? {} : { country: next, province: "", city: "" })}
      />
      <FreeField id={id("addressLine")} label={labels.line} hint={labels.lineHint} value={value.addressLine} onChange={(v) => onChange({ addressLine: v })} error={errors.addressLine} autoComplete="off" />
      {country === "US" ? (
        <OptionPicker id={id("province")} label={labels.province} value={value.province} options={US_OPTIONS} searchLabel="Search states" error={errors.province} onChange={(v) => onChange({ province: v })} />
      ) : country === "PH" ? (
        <OptionPicker
          id={id("province")}
          label={labels.province}
          value={value.province}
          options={PH_PROVINCE_OPTIONS}
          searchLabel="Search provinces"
          error={errors.province}
          onChange={(v) => onChange({ province: v, city: v === value.province ? value.city : "" })}
        />
      ) : (
        <FreeField id={id("province")} label={labels.province} value={value.province} onChange={(v) => onChange({ province: v })} error={errors.province} autoComplete="off" />
      )}
      {country === "PH" ? (
        <OptionPicker
          id={id("city")}
          label={labels.city}
          value={value.city}
          options={phCitiesFor(value.province).map((c) => ({ value: c, label: c }))}
          searchLabel="Search cities and municipalities"
          error={errors.city}
          disabled={!value.province && !value.city}
          hint={!value.province && !value.city ? "Choose a province first." : undefined}
          onChange={(v) => onChange({ city: v })}
        />
      ) : (
        <FreeField id={id("city")} label={labels.city} value={value.city} onChange={(v) => onChange({ city: v })} error={errors.city} autoComplete="off" />
      )}
      <FreeField
        id={id("postalCode")}
        label={labels.postal}
        value={value.postalCode}
        onChange={(v) => onChange({ postalCode: v })}
        error={errors.postalCode}
        inputMode={country === "US" || country === "PH" ? "numeric" : "text"}
        maxLength={country === "US" ? 10 : country === "PH" ? 4 : 12}
        autoComplete="off"
      />
    </>
  );
}
