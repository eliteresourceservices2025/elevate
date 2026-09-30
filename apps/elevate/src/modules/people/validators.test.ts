import { describe, expect, it } from "vitest";
import {
  assignmentSchema,
  bankChangeSchema,
  contactChangeSchema,
  createEmployeeSchema,
  customFieldDefSchema,
  directoryQuerySchema,
  emergencyContactsChangeSchema,
  updateSensitiveSchema,
} from "./validators";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const base = { legalFirstName: "Maria", legalLastName: "Santos", workEmail: "Maria.Santos@Example.com" };

describe("createEmployeeSchema", () => {
  it("accepts the minimum and applies defaults", () => {
    const r = createEmployeeSchema.parse(base);
    expect(r.workEmail).toBe("maria.santos@example.com");
    expect(r.status).toBe("onboarding");
    expect(r.workerType).toBe("contractor");
    expect(r.country).toBe("PH");
  });

  it("turns blank optional fields into undefined", () => {
    const r = createEmployeeSchema.parse({ ...base, mobile: "", personalEmail: "  ", birthDate: "", positionId: "" });
    expect(r.mobile).toBeUndefined();
    expect(r.personalEmail).toBeUndefined();
    expect(r.birthDate).toBeUndefined();
    expect(r.positionId).toBeUndefined();
  });

  it("rejects missing names, bad emails, bad phones and unreal dates", () => {
    expect(createEmployeeSchema.safeParse({ ...base, legalFirstName: " " }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, workEmail: "nope" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, mobile: "call me" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, startDate: "2026-02-31" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, birthDate: "2099-01-01" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, birthDate: "1900-01-01" }).success).toBe(false);
  });

  it("rejects unknown status and worker type", () => {
    expect(createEmployeeSchema.safeParse({ ...base, status: "fired" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, workerType: "intern" }).success).toBe(false);
  });

  it("requires a last working day when separated", () => {
    expect(createEmployeeSchema.safeParse({ ...base, status: "separated" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, status: "separated", endDate: "2026-09-30" }).success).toBe(true);
  });
});

describe("updateSensitiveSchema", () => {
  it("normalises IDs and pay rate; null clears; missing leaves unchanged", () => {
    const r = updateSensitiveSchema.parse({
      employeeId: ID,
      values: { tin: "123456789012", sss: "3412345678", payRate: "25,000", bankName: null },
    });
    expect(r.values.tin).toBe("123-456-789-012");
    expect(r.values.sss).toBe("34-1234567-8");
    expect(r.values.payRate).toBe("25000.00");
    expect(r.values.bankName).toBeNull();
    expect("pagibig" in r.values && r.values.pagibig !== undefined).toBe(false);
  });

  it("rejects malformed IDs with a helpful message", () => {
    const r = updateSensitiveSchema.safeParse({ employeeId: ID, values: { tin: "12345" } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/TIN/);
  });

  it("rejects an empty change and a bad employee id", () => {
    expect(updateSensitiveSchema.safeParse({ employeeId: ID, values: {} }).success).toBe(false);
    expect(updateSensitiveSchema.safeParse({ employeeId: "x", values: { tin: "123456789" } }).success).toBe(false);
  });

  it("ignores fields that are not sensitive fields", () => {
    const r = updateSensitiveSchema.parse({ employeeId: ID, values: { tin: "123456789", isAdmin: true } });
    expect("isAdmin" in r.values).toBe(false);
  });
});

describe("self-service change schemas", () => {
  it("contact change needs at least one field", () => {
    expect(contactChangeSchema.safeParse({}).success).toBe(false);
    expect(contactChangeSchema.safeParse({ mobile: "+63 917 123 4567" }).success).toBe(true);
    expect(contactChangeSchema.parse({ mobile: "+63 917 123 4567" }).country).toBeUndefined();
  });

  it("emergency contacts need exactly one primary and at most five", () => {
    const c = (primary: boolean) => ({ name: "Ana", relationship: "Sister", phone: "0917 123 4567", isPrimary: primary });
    expect(emergencyContactsChangeSchema.safeParse({ contacts: [] }).success).toBe(false);
    expect(emergencyContactsChangeSchema.safeParse({ contacts: [c(false)] }).success).toBe(false);
    expect(emergencyContactsChangeSchema.safeParse({ contacts: [c(true), c(true)] }).success).toBe(false);
    expect(emergencyContactsChangeSchema.safeParse({ contacts: [c(true), c(false)] }).success).toBe(true);
    expect(emergencyContactsChangeSchema.safeParse({ contacts: Array(6).fill(c(true)) }).success).toBe(false);
  });

  it("bank change normalises the account number", () => {
    const r = bankChangeSchema.parse({ bankName: "Test Bank", bankAccountName: "Maria Santos", bankAccountNumber: " 0012  3456 7890 " });
    expect(r.bankAccountNumber).toBe("0012 3456 7890");
    expect(bankChangeSchema.safeParse({ bankName: "", bankAccountName: "x", bankAccountNumber: "123456" }).success).toBe(false);
  });
});

describe("assignmentSchema", () => {
  it("accepts optional hours and rejects out-of-range hours", () => {
    expect(assignmentSchema.safeParse({ employeeId: ID, clientId: OTHER, startDate: "2026-09-01" }).success).toBe(true);
    expect(assignmentSchema.parse({ employeeId: ID, clientId: OTHER, startDate: "2026-09-01", hoursPerWeek: "20" }).hoursPerWeek).toBe(20);
    expect(assignmentSchema.safeParse({ employeeId: ID, clientId: OTHER, startDate: "2026-09-01", hoursPerWeek: 81 }).success).toBe(false);
    expect(assignmentSchema.safeParse({ employeeId: ID, clientId: OTHER, startDate: "2026-09-01", hoursPerWeek: 0 }).success).toBe(false);
  });
});

describe("customFieldDefSchema", () => {
  const def = { key: "shirt_size", label: "Shirt size", fieldType: "select" as const };
  it("select fields need two different options", () => {
    expect(customFieldDefSchema.safeParse(def).success).toBe(false);
    expect(customFieldDefSchema.safeParse({ ...def, options: ["S"] }).success).toBe(false);
    expect(customFieldDefSchema.safeParse({ ...def, options: ["S", "S"] }).success).toBe(false);
    expect(customFieldDefSchema.safeParse({ ...def, options: ["S", "M"] }).success).toBe(true);
  });
  it("keys are lowercase slugs and visibility defaults to HR only", () => {
    expect(customFieldDefSchema.safeParse({ ...def, fieldType: "text", key: "Shirt Size" }).success).toBe(false);
    expect(customFieldDefSchema.parse({ key: "nickname", label: "Nickname", fieldType: "text" }).visibility).toBe("hr_only");
  });
});

describe("directoryQuerySchema", () => {
  it("falls back to safe defaults on junk input", () => {
    const r = directoryQuerySchema.parse({ page: "abc", sort: "password", dir: "sideways", status: "", archived: undefined });
    expect(r).toMatchObject({ page: 1, sort: "name", dir: "asc", archived: false });
    expect(r.status).toBeUndefined();
  });
  it("accepts valid filters", () => {
    const r = directoryQuerySchema.parse({ q: " maria ", status: "active", page: "3", sort: "start", dir: "desc", archived: "1" });
    expect(r).toMatchObject({ q: "maria", status: "active", page: 3, sort: "start", dir: "desc", archived: true });
  });
});
