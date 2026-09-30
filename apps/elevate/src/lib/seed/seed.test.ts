import { describe, expect, it } from "vitest";
import { buildSeedDataset } from "./data";
import { assertSeedAllowed } from "./guard";

describe("seed dataset", () => {
  const data = buildSeedDataset();

  it("has 40 employees, 5 teams and 6 clients", () => {
    expect(data.employees).toHaveLength(40);
    expect(data.teams).toHaveLength(5);
    expect(data.clients).toHaveLength(6);
  });

  it("is identical on every run", () => {
    expect(buildSeedDataset()).toEqual(data);
  });

  it("uses unique example.com emails", () => {
    const emails = data.employees.map((e) => e.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(email).toMatch(/^[a-z.0-9]+@example\.com$/);
  });

  it("gives every team exactly one lead and every client at least one person", () => {
    for (const team of data.teams) {
      const members = data.employees.filter((e) => e.team === team.name);
      expect(members.length).toBeGreaterThan(0);
      expect(members.filter((e) => e.isTeamLead)).toHaveLength(1);
    }
    for (const client of data.clients) expect(data.employees.some((e) => e.client === client.name)).toBe(true);
  });

  it("only uses obviously fake government and bank numbers", () => {
    for (const { sensitive: s } of data.employees) {
      expect(s.tin).toMatch(/^000-000-/);
      expect(s.sss).toMatch(/^00-/);
      expect(s.philhealth).toMatch(/^00-/);
      expect(s.pagibig).toMatch(/^0000-/);
      expect(s.bankAccount).toMatch(/^FAKE-/);
    }
  });

  it("mixes Filipino and US names and valid start dates", () => {
    const names = data.employees.map((e) => e.lastName);
    expect(names).toContain("Santos");
    expect(names).toContain("Miller");
    for (const e of data.employees) expect(Number.isNaN(Date.parse(e.startDate))).toBe(false);
  });
});

describe("assertSeedAllowed", () => {
  const local = {
    DATABASE_URL_DIRECT: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  };

  it("allows a fully local setup", () => {
    expect(() => assertSeedAllowed(local)).not.toThrow();
    expect(() => assertSeedAllowed({ ...local, DATABASE_URL_DIRECT: "postgresql://u:p@localhost:5432/db" })).not.toThrow();
  });

  it("refuses production, however it is configured", () => {
    expect(() => assertSeedAllowed({ ...local, ELEVATE_ENV: "production" })).toThrow(/production/);
  });

  it("refuses any remote database unless explicitly marked staging", () => {
    const remote = {
      DATABASE_URL_DIRECT: "postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
    };
    expect(() => assertSeedAllowed(remote)).toThrow(/remote/);
    expect(() => assertSeedAllowed({ ...remote, ELEVATE_ENV: "staging" })).not.toThrow();
  });

  it("refuses a mix of local database and remote auth (or the reverse)", () => {
    expect(() => assertSeedAllowed({ ...local, NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co" })).toThrow();
  });

  it("refuses missing or malformed URLs", () => {
    expect(() => assertSeedAllowed({})).toThrow();
    expect(() => assertSeedAllowed({ ...local, DATABASE_URL_DIRECT: "not a url" })).toThrow();
  });
});
