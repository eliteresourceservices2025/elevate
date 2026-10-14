import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertPrivateInputPaths, assertProductionTarget, digest, mappingSchema, parseArgs, parseTimesheet, planRows } from "../scripts/schedule-import-core";

const sheet = (body: string) => `10/12/26,Monday,,,,,,,,\n,Name,Client,Schedule,In,Lunch,Back,Out,Total Hours\n${body}`;
const entry = (name = "Example Person", client = "Invented Clinic") => ({
  name, client, employeeId: randomUUID(), employeeWorkEmail: "invented@example.com",
  clientId: randomUUID(), clientName: client, assignmentStartDate: "2026-10-12",
  scheduleText: "9:00am to 5:00pm ET", shift: {
    effectiveFrom: "2026-10-12", startTime: "09:00", endTime: "17:00",
    zone: "America/New_York", weekdays: [1, 2, 3, 4, 5], breakMinutes: 0,
  }, hoursPerWeek: null,
});

describe("schedule import input and guards", () => {
  it("reads quoted commas and line breaks without mistaking a header for a person", () => {
    const observations = parseTimesheet(sheet(',"Example, Person","Invented\nClinic",9:00am to 5:00pm ET,,,,,8\n'));
    expect(observations).toMatchObject([{ date: "2026-10-12", name: "Example, Person", client: "Invented\nClinic" }]);
  });

  it("refuses malformed quotes and dates without returning personal values", () => {
    for (const input of [sheet(',"Example Person,Invented Clinic,shift\n'),
      '02/30/26,Monday\n,Name,Client,Schedule\n,Example Person,Invented Clinic,shift\n',
      ',Example Person,Invented Clinic,shift\n']) {
      expect(() => parseTimesheet(input)).toThrow();
      try { parseTimesheet(input); } catch (e) { expect(String(e)).not.toContain("Example Person"); }
    }
  });

  it("requires a header for every date and rejects malformed section rows", () => {
    expect(() => parseTimesheet('10/12/26,Monday\n,Example Person,Invented Clinic,shift,,,,,8\n')).toThrow();
    expect(() => parseTimesheet('10/12/26,Monday\n,Name,Client,Schedule,In,Lunch,Back,Out,Total Hours\n10/13/26,Tuesday\n,Example Person,Invented Clinic,shift,,,,,8\n')).toThrow();
    expect(() => parseTimesheet(sheet(',Example Person,Invented Clinic,shift,,,,,8\n,Missing Person,Invented Clinic,shift,,,,,8\n'))).not.toThrow();
    expect(() => parseTimesheet(sheet(',Example Person,Invented Clinic,shift,,,,,8\n,Incomplete,Invented Clinic,,In\n'))).toThrow();
  });

  it("skips training and explicit zero-hour observations", () => {
    const rows = parseTimesheet(sheet(',Example Person,Invented Clinic,Training,,,,,0\n,Example Person,Invented Clinic,shift,,,,,0\n,Example Person,Invented Clinic,shift,,,,,0.00\n,Example Person,Invented Clinic,shift,,,,,0:00\n,Example Person,Invented Clinic,shift,,,,,8\n'));
    expect(rows).toHaveLength(1);
    expect(() => parseTimesheet(sheet(',Example Person,Invented Clinic,shift,,,,,unknown\n'))).toThrow();
    expect(() => parseTimesheet(sheet(',Example Person,Invented Clinic,shift,,,,,8:60\n'))).toThrow();
  });

  it("requires complete reviewed mapping and rejects conflict or multiple clients", () => {
    const rows = parseTimesheet(sheet(',Example Person,Invented Clinic,9:00am to 5:00pm ET,,,,,8\n'));
    const mapped = mappingSchema.parse({ entries: [entry()] });
    expect(planRows(rows, mapped)).toEqual(mapped.entries);
    expect(digest(planRows(rows, mapped))).toBe(digest(planRows(rows, mapped)));
    expect(() => planRows(rows, { entries: [] })).toThrow();
    expect(() => planRows(rows, { entries: [entry(), entry()] })).toThrow();
    expect(() => planRows([{ ...rows[0], schedule: "unknown" }], mapped)).toThrow();
    expect(() => mappingSchema.parse({ entries: [{ ...entry(), shift: { ...entry().shift, zone: "Mars/Base" } }] })).toThrow();
    expect(() => planRows(rows, { entries: [{ ...mapped.entries[0], clientName: "Different client" }] })).toThrow();
  });

  it("refuses real input paths within the repository, including symlinks", () => {
    const root = mkdtempSync(path.join(tmpdir(), "import-repo-"));
    const outside = mkdtempSync(path.join(tmpdir(), "import-private-"));
    try {
      const privateFile = path.join(outside, "invented.csv");
      const inRepo = path.join(root, "invented.csv");
      writeFileSync(privateFile, "invented");
      writeFileSync(inRepo, "invented");
      expect(() => assertPrivateInputPaths([privateFile], root)).not.toThrow();
      expect(() => assertPrivateInputPaths([inRepo], root)).toThrow();
      if (platform() !== "win32") {
        const link = path.join(outside, "in-repo-link.csv");
        symlinkSync(inRepo, link, "file");
        expect(() => assertPrivateInputPaths([link], root)).toThrow();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("requires exact production database target and explicit apply approval", () => {
    const env = { ELEVATE_ENV: "production", DATABASE_URL: "postgresql://postgres.projectref:p@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
      EXPECTED_DB_HOST: "aws-0-ap-southeast-1.pooler.supabase.com", EXPECTED_DB_NAME: "postgres", EXPECTED_DB_PROJECT_REF: "projectref" };
    expect(assertProductionTarget(env)).toEqual({ host: env.EXPECTED_DB_HOST, name: "postgres", projectRef: "projectref" });
    for (const query of ["sslmode=disable", "sslmode=require", "sslmode=prefer", "sslmode=verify-full", "host=staging.example.com"]) {
      expect(() => assertProductionTarget({ ...env, DATABASE_URL: `${env.DATABASE_URL}?${query}` })).toThrow();
    }
    expect(() => assertProductionTarget({ ...env, DATABASE_URL: "postgresql://u:p@staging.example.com:6543/postgres",
      EXPECTED_DB_HOST: "staging.example.com" })).toThrow();
    expect(() => assertProductionTarget({ ...env, DATABASE_URL: "postgresql://u:p@127.0.0.1/elevate", EXPECTED_DB_HOST: "127.0.0.1" })).toThrow();
    expect(() => assertProductionTarget({ ...env, ELEVATE_ENV: "staging" })).toThrow();
    expect(() => parseArgs(["--csv", "x", "--mapping", "m", "--as", "hr@example.com", "--apply", "confirm"])).toThrow();
    expect(parseArgs(["--csv", "x", "--mapping", "m", "--as", "hr@example.com"]).apply).toBe(false);
  });
});
