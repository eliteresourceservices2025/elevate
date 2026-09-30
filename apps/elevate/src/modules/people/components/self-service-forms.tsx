"use client";

/* eslint-disable security/detect-object-injection -- indexes come from useFieldArray, never from user input */

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { requestBankChange, requestContactChange, requestEmergencyContactsChange } from "../actions";
import {
  bankChangeSchema,
  contactChangeSchema,
  emergencyContactsChangeSchema,
  type BankChangeInput,
  type ContactChangeInput,
  type EmergencyContactsInput,
} from "../validators";

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
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactChangeInput>({
    resolver: zodResolver(contactChangeSchema) as unknown as Resolver<ContactChangeInput>,
    defaultValues: current,
  });

  return (
    <form onSubmit={handleSubmit(async (v) => void done(await requestContactChange(v)))} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
      <p className="text-sm text-muted-foreground">Change what you need. HR reviews it before it applies.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="c-mobile" label="Mobile" type="tel" error={errors.mobile?.message} {...register("mobile")} />
        <TextField id="c-personalEmail" label="Personal email" type="email" error={errors.personalEmail?.message} {...register("personalEmail")} />
        <TextField id="c-addressLine" label="Address" error={errors.addressLine?.message} {...register("addressLine")} />
        <TextField id="c-city" label="City" error={errors.city?.message} {...register("city")} />
        <TextField id="c-province" label="Province" error={errors.province?.message} {...register("province")} />
        <TextField id="c-postalCode" label="Postal code" error={errors.postalCode?.message} {...register("postalCode")} />
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
