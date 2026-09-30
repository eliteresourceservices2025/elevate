"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { FormSection, SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { createEmployee, updateEmployee } from "../actions";
import { CIVIL_STATUSES, EMPLOYEE_STATUSES, statusLabel, WORKER_TYPES } from "../constants";
import { employeeFieldsSchema, type EmployeeFieldsInput } from "../validators";

type Props = { mode: "create" } | { mode: "edit"; employeeId: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ");

export function EmployeeForm(props: Props & { defaults?: Partial<EmployeeFieldsInput> }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFieldsInput>({
    resolver: zodResolver(employeeFieldsSchema) as unknown as Resolver<EmployeeFieldsInput>,
    defaultValues: { status: "onboarding", workerType: "contractor", country: "PH", ...props.defaults },
  });
  const status = useWatch({ control, name: "status" });

  async function onSubmit(values: EmployeeFieldsInput) {
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
        <TextField id="position" label="Position" error={errors.position?.message} {...register("position")} />
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

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {props.mode === "create" ? "Add person" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
