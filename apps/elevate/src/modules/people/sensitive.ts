import { maskValue } from "@/lib/crypto-core";
import type { SensitiveField } from "./constants";

// Pure helpers shared by the app and the seed script.

/** Where an encrypted value lives. Reading and writing must use the same string. */
export const sensitiveContext = (field: SensitiveField, employeeId: string) =>
  `employee_sensitive:${field}:${employeeId}`;

export const changeRequestContext = (requestId: string) => `change_request:${requestId}`;

// Masked strings are stored at write time so showing them never needs a decrypt.
const MASKED_WITH_LAST_DIGITS: readonly SensitiveField[] = ["tin", "sss", "philhealth", "pagibig", "bankAccountNumber"];
export const maskFor = (field: SensitiveField, value: string) =>
  MASKED_WITH_LAST_DIGITS.includes(field) ? maskValue(value) : "••••••";
