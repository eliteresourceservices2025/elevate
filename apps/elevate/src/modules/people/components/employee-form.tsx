"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { FormSection, SelectField, TextField } from "@/components/form-fields";
import { PersonPicker, type PickerOption } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { createEmployee, updateEmployee } from "../actions";
import { CIVIL_STATUSES, EMPLOYEE_STATUSES, WORKER_TYPES, statusLabel } from "../constants";
import { createEmployeeSchema, employeeFieldsSchema, type EmployeeFieldsInput } from "../validators";

type Options = {
  positions: { id: string; title: string }[];
  teams: { id: string; name: string }[];
  managers: PickerOption[];
};

type Props = ({ mode: "create" } | { mode: "edit"; employeeId: string }) & {
  options: Options;
  defaults?: Partial<EmployeeFieldsInput>;
};

type FormValues = EmployeeFieldsInput & { teamId?: string; managerId?: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ");

export function EmployeeForm(props: Props) {
  const router = useRouter();
  const creating = props.mode === "create";
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(creating ? createEmployeeSchema : employeeFieldsSchema) as unknown as Resolver<FormValues>,
    defaultValues: { status: "onboarding", workerType: "contractor", country: "PH", ...props.defaults },
  });
  const status = useWatch({ control, name: "status" });

  async function onSubmit(values: FormValues) {
    const result =
      props.mode === "create" ? await createEmployee(values) : await updateEmployee({ ...values, employeeId: props.employeeId });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(props.mode === "create" ? "Person added." : "Changes saved.");
    const id = props.mode === "create" ? (result as { data: { id: string } }).data.id : props.employeeId;
    router.push(`/people/${id}`);
    router.refresh();
  }

  const { positions, teams, managers } = props.options;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <FormSection title="Name">
        <TextField id="legalFirstName" label="Legal first name" error={errors.legalFirstName?.message} {...register("legalFirstName")} />
        <TextField id="legalMiddleName" label="Legal middle name" error={errors.legalMiddleName?.message} {...register("legalMiddleName")} />
        <TextField id="legalLastName" label="Legal last name" error={errors.legalLastName?.message} {...register("legalLastName")} />
        <TextField id="preferredName" label="Preferred name" hint="Shown in the directory instead of the first name." error={errors.preferredName?.message} {...register("preferredName")} />
      </FormSection>

      <FormSection title="Personal">
        <TextField id="birthDate" label="Birth date" type="date" error={errors.birthDate?.message} {...register("birthDate")} />
        <SelectField id="civilStatus" label="Civil status" error={errors.civilStatus?.message} {...register("civilStatus")}>
          <option value="">Not set</option>
          {CIVIL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {cap(s)}
            </option>
          ))}
        </SelectField>
      </FormSection>

      <FormSection title="Contact" description="Personal contact details are visible only to HR and the person.">
        <TextField id="workEmail" label="Work email" type="email" autoComplete="off" error={errors.workEmail?.message} {...register("workEmail")} />
        <TextField id="personalEmail" label="Personal email" type="email" autoComplete="off" error={errors.personalEmail?.message} {...register("personalEmail")} />
        <TextField id="mobile" label="Mobile" type="tel" autoComplete="off" error={errors.mobile?.message} {...register("mobile")} />
        <TextField id="addressLine" label="Address" error={errors.addressLine?.message} {...register("addressLine")} />
        <TextField id="city" label="City" error={errors.city?.message} {...register("city")} />
        <TextField id="province" label="Province" error={errors.province?.message} {...register("province")} />
        <TextField id="postalCode" label="Postal code" error={errors.postalCode?.message} {...register("postalCode")} />
        <TextField id="country" label="Country code" hint="Two letters, for example PH." maxLength={2} error={errors.country?.message} {...register("country")} />
      </FormSection>

      <FormSection title="Employment">
        <SelectField id="positionId" label="Position" error={errors.positionId?.message as string | undefined} {...register("positionId")}>
          <option value="">Not set</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </SelectField>
        <SelectField id="status" label="Status" error={errors.status?.message} {...register("status")}>
          {EMPLOYEE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </SelectField>
        <SelectField id="workerType" label="Worker type" error={errors.workerType?.message} {...register("workerType")}>
          {WORKER_TYPES.map((w) => (
            <option key={w} value={w}>
              {cap(w)}
            </option>
          ))}
        </SelectField>
        <TextField id="startDate" label="Start date" type="date" error={errors.startDate?.message} {...register("startDate")} />
        {status === "separated" ? (
          <TextField id="endDate" label="Last working day" type="date" error={errors.endDate?.message} {...register("endDate")} />
        ) : null}
      </FormSection>

      {creating ? (
        <FormSection title="Team and manager" description="Optional. You can also set these later on the profile.">
          <SelectField id="teamId" label="Team" error={errors.teamId?.message as string | undefined} {...register("teamId")}>
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
          <Controller
            control={control}
            name="managerId"
            render={({ field }) => (
              <PersonPicker
                id="managerId"
                label="Manager"
                options={managers}
                value={field.value}
                onChange={field.onChange}
                error={errors.managerId ? "Choose a person from the list" : undefined}
              />
            )}
          />
        </FormSection>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {creating ? "Add person" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
