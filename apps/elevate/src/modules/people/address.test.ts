import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COUNTRY_OPTIONS, PH_PROVINCES, US_STATES, addressIssues, countryName, formatAddress, phCitiesFor } from "./address-data";
import { AddressFields } from "./components/address-fields";
import {
  contactChangeSchema,
  contactChangeSchemaFor,
  createEmployeeSchema,
  importedEmployeeSchema,
  updateEmployeeSchemaFor,
} from "./validators";

const ID = "11111111-1111-4111-8111-111111111111";
const base = { legalFirstName: "Maria", legalLastName: "Santos", workEmail: "maria@example.com" };
const messages = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));

describe("address data", () => {
  it("has the Philippine provinces with their cities and Metro Manila", () => {
    expect(PH_PROVINCES.length).toBeGreaterThanOrEqual(80);
    expect(phCitiesFor("Metro Manila")).toContain("City of Makati");
    expect(phCitiesFor("Cebu")).toContain("City of Cebu");
    expect(phCitiesFor("Basilan")).toContain("City of Isabela");
  });

  it("lists every state and names every country code", () => {
    expect(US_STATES.some((s) => s.code === "AZ")).toBe(true);
    expect(new Set(COUNTRY_OPTIONS.map((c) => c.code)).size).toBe(COUNTRY_OPTIONS.length);
    for (const c of COUNTRY_OPTIONS) expect(countryName(c.code), c.code).not.toBe(c.code);
    expect(COUNTRY_OPTIONS.slice(0, 2).map((c) => c.code)).toEqual(["PH", "US"]);
  });

  it("formats an address in each country's order, and nothing for a country alone", () => {
    expect(formatAddress({ addressLine: "12 Rizal St", city: "City of Makati", province: "Metro Manila", postalCode: "1200", country: "PH" })).toBe(
      "12 Rizal St, City of Makati, Metro Manila 1200, Philippines",
    );
    expect(formatAddress({ addressLine: "100 Main St", city: "Phoenix", province: "AZ", postalCode: "85001", country: "US" })).toBe(
      "100 Main St, Phoenix, AZ 85001, United States",
    );
    expect(formatAddress({ country: "PH" })).toBe("");
  });
});

describe("address rules", () => {
  const ph = { country: "PH", province: "Cebu", city: "City of Cebu", postalCode: "6000" };

  it("accepts a Philippine address from the lists and rejects values outside them", () => {
    expect(createEmployeeSchema.safeParse({ ...base, ...ph }).success).toBe(true);
    expect(messages(createEmployeeSchema.safeParse({ ...base, ...ph, province: "Narnia" })).province).toMatch(/province/);
    expect(messages(createEmployeeSchema.safeParse({ ...base, ...ph, city: "City of Makati" })).city).toMatch(/city/i);
    expect(messages(createEmployeeSchema.safeParse({ ...base, ...ph, postalCode: "60000" })).postalCode).toMatch(/4-digit/);
  });

  it("accepts a US address and checks the state and ZIP", () => {
    const us = { country: "US", province: "AZ", city: "Phoenix", postalCode: "85001-1234" };
    expect(createEmployeeSchema.safeParse({ ...base, ...us }).success).toBe(true);
    expect(createEmployeeSchema.safeParse({ ...base, ...us, postalCode: "85001" }).success).toBe(true);
    expect(messages(createEmployeeSchema.safeParse({ ...base, ...us, province: "Arizona" })).province).toMatch(/state/);
    expect(messages(createEmployeeSchema.safeParse({ ...base, ...us, postalCode: "8500" })).postalCode).toMatch(/ZIP/);
  });

  it("leaves other countries as free text", () => {
    expect(createEmployeeSchema.safeParse({ ...base, country: "CA", province: "Ontario", city: "Toronto", postalCode: "M5V 2T6" }).success).toBe(true);
  });

  it("defaults the country to the Philippines", () => {
    expect(messages(createEmployeeSchema.safeParse({ ...base, province: "Arizona" })).province).toBeDefined();
  });

  it("lets an unchanged old free-text address save, but not a changed one", () => {
    const old = { country: "PH", province: "NCR", city: "Makati", postalCode: "1200" };
    const update = updateEmployeeSchemaFor(old);
    expect(update.safeParse({ ...base, ...old, employeeId: ID }).success).toBe(true);
    expect(update.safeParse({ ...base, ...old, employeeId: ID, city: "Gotham" }).success).toBe(false);
    expect(updateEmployeeSchemaFor().safeParse({ ...base, ...old, employeeId: ID }).success).toBe(false);
  });

  it("does not carry an old value across a change of country", () => {
    const old = { country: "PH", province: "Arizona", city: "", postalCode: "" };
    expect(updateEmployeeSchemaFor(old).safeParse({ ...base, country: "US", province: "Arizona", employeeId: ID }).success).toBe(false);
  });

  it("checks a contact change against the saved country when it sends none", () => {
    const saved = { country: "US", province: "AZ", city: "Phoenix", postalCode: "85001" };
    expect(contactChangeSchemaFor(saved).safeParse({ postalCode: "85004" }).success).toBe(true);
    expect(contactChangeSchemaFor(saved).safeParse({ postalCode: "8500" }).success).toBe(false);
    expect(contactChangeSchema.safeParse({ mobile: "+63 917 123 4567" }).success).toBe(true);
    expect(contactChangeSchemaFor({ country: "PH", postalCode: "1200abc" }).safeParse({ postalCode: "1200abc" }).success).toBe(true);
  });

  it("does not enforce the lists on imported records", () => {
    expect(importedEmployeeSchema.safeParse({ ...base, province: "NCR", city: "Makati", postalCode: "1200" }).success).toBe(true);
    expect(addressIssues({ country: "PH", province: "NCR" })).toHaveLength(1);
  });
});

describe("AddressFields", () => {
  const render = (value: object) =>
    renderToStaticMarkup(createElement(AddressFields, { idPrefix: "t", value, onChange: () => {} }));

  it("uses Philippine labels and a city picker that waits for a province", () => {
    const html = render({ country: "PH" });
    expect(html).toContain("Province");
    expect(html).toContain("City or municipality");
    expect(html).toContain("Postal code");
    expect(html).toContain("Choose a province first.");
  });

  it("uses US labels and the state's name", () => {
    const html = render({ country: "US", province: "AZ" });
    expect(html).toContain("State");
    expect(html).toContain("ZIP code");
    expect(html).toContain("Street address");
    expect(html).toContain("Arizona (AZ)");
  });

  it("shows an old value that is not in the list as current", () => {
    expect(render({ country: "PH", province: "NCR" })).toContain("(current) NCR");
  });

  it("uses plain text boxes for other countries", () => {
    const html = render({ country: "CA", province: "Ontario" });
    expect(html).toContain("State or region");
    expect(html).toContain('value="Ontario"');
  });
});
