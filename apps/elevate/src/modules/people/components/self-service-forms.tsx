"use client";

/* eslint-disable security/detect-object-injection -- indexes come from useFieldArray, never from user input */

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { requestBankChange, requestContactChange, requestEmergencyContactsChange } from "../actions";
import {
  bankChangeSchema,
  contactChangeSchemaFor,
  emergencyContactsChangeSchema,
  type BankChangeInput,
  type ContactChangeInput,
  type EmergencyContactsInput,
} from "../validators";
import { savedAddressOf } from "../address-data";
import { AddressFields, type AddressValue } from "./address-fields";

// Self-service forms. Nothing is saved directly: each one sends a request that HR approves.

function useSubmitted() {
  const router = useRouter();
  return (result: { ok: boolean; error?: string }) => {
    if (!result.ok) {
      toast.error(result.error ?? "Something went wrong.");
      return false;
    }
    toast.success("Sent to HR for approval.");
    router.refresh();
    return true;
  };
}

export function ContactChangeForm({ current }: { current: ContactChangeInput }) {
  const done = useSubmitted();
  // What is already saved keeps saving as it is; only a changed address must fit the country lists.
  const resolver = useMemo(
    () => zodResolver(contactChangeSchemaFor(savedAddressOf(current))) as unknown as Resolver<ContactChangeInput>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the saved address is read once, when the form opens
    [],
  );
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ContactChangeInput>({ resolver, defaultValues: { ...current, country: current.country || "PH" } });
  const [addressLine, city, province, postalCode, country] = useWatch({ control, name: ["addressLine", "city", "province", "postalCode", "country"] });

  return (
    <form onSubmit={handleSubmit(async (v) => void done(await requestContactChange(v)))} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
      <p className="text-sm text-muted-foreground">Change what you need. HR reviews it before it applies.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="c-mobile" label="Mobile" type="tel" error={errors.mobile?.message} {...register("mobile")} />
        <TextField id="c-personalEmail" label="Personal email" type="email" error={errors.personalEmail?.message} {...register("personalEmail")} />
        <AddressFields
          idPrefix="c"
          value={{ addressLine, city, province, postalCode, country } as AddressValue}
          onChange={(patch) => {
            for (const [k, v] of Object.entries(patch)) setValue(k as "city", v, { shouldDirty: true });
          }}
          errors={{ addressLine: errors.addressLine?.message, city: errors.city?.message, province: errors.province?.message, postalCode: errors.postalCode?.message, country: errors.country?.message }}
        />
      </div>
      {errors.root?.message ? <p role="alert" className="text-sm text-destructive">{errors.root.message}</p> : null}
      <Button type="submit" disabled={isSubmitting}>
        Request change
      </Button>
    </form>
  );
}

export function EmergencyContactsForm({ current }: { current: EmergencyContactsInput["contacts"] }) {
  const done = useSubmitted();
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EmergencyContactsInput>({
    resolver: zodResolver(emergencyContactsChangeSchema) as unknown as Resolver<EmergencyContactsInput>,
    defaultValues: { contacts: current.length ? current : [{ name: "", relationship: "", phone: "", isPrimary: true }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "contacts" });
  const contacts = useWatch({ control, name: "contacts" });

  return (
    <form onSubmit={handleSubmit(async (v) => void done(await requestEmergencyContactsChange(v)))} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
      <p className="text-sm text-muted-foreground">Up to five people HR can call in an emergency. Choose one primary contact.</p>
      {fields.map((field, i) => (
        <div key={field.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4">
          <TextField id={`e-name-${i}`} label="Name" error={errors.contacts?.[i]?.name?.message} {...register(`contacts.${i}.name`)} />
          <TextField id={`e-rel-${i}`} label="Relationship" error={errors.contacts?.[i]?.relationship?.message} {...register(`contacts.${i}.relationship`)} />
          <TextField id={`e-phone-${i}`} label="Phone" type="tel" error={errors.contacts?.[i]?.phone?.message} {...register(`contacts.${i}.phone`)} />
          <div className="flex items-end gap-3 pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="primaryContact"
                className="size-4 accent-primary"
                checked={contacts?.[i]?.isPrimary ?? false}
                onChange={() => fields.forEach((_, j) => setValue(`contacts.${j}.isPrimary`, j === i, { shouldDirty: true }))}
              />
              Primary
            </label>
            {fields.length > 1 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}>
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      {errors.contacts?.root?.message ?? errors.contacts?.message ? (
        <p role="alert" className="text-sm text-destructive">{errors.contacts?.root?.message ?? errors.contacts?.message}</p>
      ) : null}
      <div className="flex gap-3">
        {fields.length < 5 ? (
          <Button type="button" variant="outline" onClick={() => append({ name: "", relationship: "", phone: "", isPrimary: false })}>
            Add another
          </Button>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          Request change
        </Button>
      </div>
    </form>
  );
}

export function BankChangeForm() {
  const done = useSubmitted();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BankChangeInput>({ resolver: zodResolver(bankChangeSchema) as unknown as Resolver<BankChangeInput> });

  return (
    <form
      onSubmit={handleSubmit(async (v) => {
        if (done(await requestBankChange(v))) reset();
      })}
      className="space-y-4 rounded-xl border bg-card p-4"
      noValidate
    >
      <p className="text-sm text-muted-foreground">
        New payout details are encrypted right away and stay hidden until an admin approves them. HR may contact you to verify.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField id="b-bank" label="Bank name" autoComplete="off" error={errors.bankName?.message} {...register("bankName")} />
        <TextField id="b-name" label="Account name" autoComplete="off" error={errors.bankAccountName?.message} {...register("bankAccountName")} />
        <TextField id="b-number" label="Account number" autoComplete="off" error={errors.bankAccountNumber?.message} {...register("bankAccountNumber")} />
      </div>
      <Button type="submit" disabled={isSubmitting}>
        Request change
      </Button>
    </form>
  );
}
