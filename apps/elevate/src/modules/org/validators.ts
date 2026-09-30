import { z } from "zod";
import { isoDate } from "@/modules/people/validators";

const uuid = z.uuid();
const name = (label: string) => z.string().trim().min(2, `Enter ${label}`).max(80, "Use 80 characters or fewer");
const optionalUuid = z.preprocess((v) => (v === "" ? undefined : v), uuid.optional());

export const createDepartmentSchema = z.object({ name: name("a department name") });
export const updateDepartmentSchema = createDepartmentSchema.extend({ departmentId: uuid });

export const createTeamSchema = z.object({ name: name("a team name"), departmentId: uuid });
export const updateTeamSchema = createTeamSchema.extend({ teamId: uuid });

export const createPositionSchema = z.object({ title: name("a position title"), departmentId: optionalUuid });
export const updatePositionSchema = createPositionSchema.extend({ positionId: uuid });

export const archiveDepartmentSchema = z.object({ departmentId: uuid });
export const archiveTeamSchema = z.object({ teamId: uuid });
export const archivePositionSchema = z.object({ positionId: uuid });

/** `undefined` leaves a value as it is, `null` clears it. */
export const setReportingSchema = z
  .object({
    employeeId: uuid,
    teamId: z.union([uuid, z.null()]).optional(),
    managerId: z.union([uuid, z.null()]).optional(),
    effectiveDate: isoDate,
  })
  .refine((v) => v.teamId !== undefined || v.managerId !== undefined, "Choose a team or a manager to change");

export const reassignReportsSchema = z.object({
  fromManagerId: uuid,
  toManagerId: z.union([uuid, z.null()]),
  effectiveDate: isoDate,
});
