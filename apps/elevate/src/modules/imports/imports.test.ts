import { describe, expect, it } from "vitest";
import { fakeCompany, fakePerson, toCsv, TALENTHR_HEADERS } from "../../../tests/fixtures/talenthr-export";
import { parseCsv } from "./csv";
import { checkMapping, defaultMapping } from "./mapping";
import { changedFields, countryCode, normalizeRow, parseDate } from "./normalize";

const opts = { dateFormat: "mdy" as const, today: "2026-10-03" };
const mapping = defaultMapping([...TALENTHR_HEADERS]);
const norm = (over = {}) => normalizeRow(fakePerson(1, over) as Record<string, string>, mapping, opts);

describe("parseCsv", () => {
  it("drops TalentHR's instruction row (GUIDE ROW = yes) and keeps people (GUIDE ROW = no)", () => {
    const guide = `GUIDE ROW
(Do not edit this column)`;
    const text = `Name,"${guide}"
"REQUIRED.
- Enter a name",yes
Ana,no
`;
    expect(parseCsv(text)).toEqual({ headers: ["Name", guide], rows: [{ Name: "Ana", [guide]: "no" }] });
  });

  it("reads quoted values, doubled quotes, commas and line breaks inside quotes", () => {
    const r = parseCsv('A,B\r\n"x, y","say ""hi""\nnext"\r\n1,2\r\n');
    expect(r).toEqual({ headers: ["A", "B"], rows: [{ A: "x, y", B: 'say "hi"\nnext' }, { A: "1", B: "2" }] });
  });
  it("ignores a byte-order mark and blank lines", () => {
    expect(parseCsv("﻿A\n1\n\n2\n")).toEqual({ headers: ["A"], rows: [{ A: "1" }, { A: "2" }] });
  });
  it("refuses empty files, repeated headers, unclosed quotes and extra values", () => {
    expect(parseCsv("")).toHaveProperty("error");
    expect(parseCsv("A,a\n1,2")).toHaveProperty("error");
    expect(parseCsv('A\n"open')).toHaveProperty("error");
    expect(parseCsv("A\n1,2")).toHaveProperty("error");
    expect(parseCsv("A,B\n")).toHaveProperty("error");
  });
  it("reads the fake TalentHR export with all 45 columns", () => {
    const r = parseCsv(toCsv(fakeCompany("t")));
    expect("error" in r).toBe(false);
    if ("headers" in r) {
      expect(r.headers).toHaveLength(45);
      expect(r.rows).toHaveLength(5);
    }
  });
});

describe("mapping", () => {
  it("maps the known TalentHR columns and leaves sensitive ones out", () => {
    expect(mapping["Email *"]).toBe("email");
    expect(mapping["Pay Rate *"]).toBe("pay_rate");
    expect(mapping["custom_fields:Phone"]).toBe("mobile");
    expect(mapping["custom_fields:Gender"]).toBe("ignore");
    expect(mapping["custom_fields:Compensation and Benefits"]).toBe("ignore");
    expect(mapping["custom_fields:Notes"]).toBe("ignore");
    expect(mapping["custom_fields:Avatar"]).toBe("ignore");
    expect(mapping["Department"]).toBe("team");
  });
  it("needs an email, a first name and a last name, and each place only once", () => {
    expect(checkMapping(mapping, [...TALENTHR_HEADERS])).toEqual([]);
    expect(checkMapping({ ...mapping, "Email *": "ignore" }, [...TALENTHR_HEADERS])[0]).toMatch(/email/);
    expect(checkMapping({ ...mapping, "Last Name *": "first_name" }, [...TALENTHR_HEADERS]).join(" ")).toMatch(/same place/);
    expect(checkMapping({ ...mapping, Location: "custom:Shirt size" }, [...TALENTHR_HEADERS]).join(" ")).toMatch(/same custom field/);
  });
});

describe("dates and countries", () => {
  it("reads month/day/year, day/month/year and ISO, and refuses impossible dates", () => {
    expect(parseDate("06/02/2025", "mdy")).toBe("2025-06-02");
    expect(parseDate("06/02/2025", "dmy")).toBe("2025-02-06");
    expect(parseDate("2025-06-02", "mdy")).toBe("2025-06-02");
    expect(parseDate("13/02/2025", "mdy")).toBeNull();
    expect(parseDate("02/30/2025", "mdy")).toBeNull();
    expect(parseDate("soon", "mdy")).toBeNull();
  });
  it("turns country names into codes", () => {
    expect(countryCode("United States")).toBe("US");
    expect(countryCode("Philippines")).toBe("PH");
    expect(countryCode("Honduras")).toBe("HN");
    expect(countryCode("ph")).toBe("PH");
    expect(countryCode("Narnia")).toBeNull();
  });
});

describe("normalizeRow", () => {
  it("builds a clean contractor from a normal row", () => {
    const r = norm();
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.input).toMatchObject({ legalFirstName: "Test1", workEmail: "import.person1@example.com", workerType: "contractor", status: "active", startDate: "2025-06-02", country: "PH", civilStatus: "single", birthDate: "1990-03-10" });
    expect(r.pay).toEqual({ rate: "12000.00", currency: "PHP" });
    expect(r.emergency).toMatchObject({ name: "Contact 1", relationship: "Sibling" });
    expect(r.teamName).toBe("Scribe");
    expect(r.positionTitle).toBe("Medical Scribe");
    expect(r.custom).toMatchObject({ Location: "Manila", "Shirt size": "4" });
    expect(r.supervisorSourceId).toBe("1001");
  });
  it("never imports the left-out columns", () => {
    const r = norm();
    expect(JSON.stringify(r)).not.toContain("Should never be imported");
    expect(JSON.stringify(r)).not.toContain("Female");
  });
  it("marks a terminated person separated with the last working day", () => {
    const r = norm({ "Employment Status": "Terminated", "Termination Date": "03/24/2026" });
    expect(r.input).toMatchObject({ status: "separated", endDate: "2026-03-24" });
  });
  it("refuses a terminated person with no usable date", () => {
    const r = norm({ "Employment Status": "Terminated", "Termination Date": "" });
    expect(r.input).toBeNull();
    expect(r.issues.some((i) => i.level === "error" && i.field === "Last working day")).toBe(true);
  });
  it("treats a future start date as onboarding", () => {
    expect(norm({ "Hire Date": "12/01/2026" }).input?.status).toBe("onboarding");
  });
  it("reports problems by field name, never by value", () => {
    const r = norm({ "Email *": "not-an-email", "Pay Rate *": "lots", "custom_fields:Phone": "call me", "custom_fields:Country": "Narnia" });
    expect(r.input).toBeNull();
    const text = JSON.stringify(r.issues);
    expect(text).not.toContain("not-an-email");
    expect(text).not.toContain("lots");
    expect(r.issues.some((i) => i.field === "Pay rate")).toBe(true);
    expect(r.issues.some((i) => i.level === "warning" && i.field === "Mobile phone")).toBe(true);
    expect(r.issues.some((i) => i.level === "warning" && i.field === "Country")).toBe(true);
  });
  it("keeps a currency other than PHP and warns about a non-monthly period", () => {
    const r = norm({ "Pay Rate Currency": "hnl", "Pay Rate Period *": "Hour" });
    expect(r.pay?.currency).toBe("HNL");
    expect(r.issues.some((i) => i.field === "Pay period")).toBe(true);
  });
  it("drops an emergency contact without a usable phone, with a warning", () => {
    const r = norm({ "custom_fields:Emergency contact phone": "" });
    expect(r.emergency).toBeNull();
    expect(r.issues.some((i) => i.field === "Emergency contact")).toBe(true);
  });
});

describe("changedFields", () => {
  it("lists names of fields that differ and ignores empty imported values", () => {
    const input = norm().input!;
    expect(changedFields(input, { legalFirstName: "Test1", legalLastName: "Person1", city: "Quezon City", birthDate: "1990-03-10", country: "PH", civilStatus: "single", mobile: input.mobile, addressLine: input.addressLine, postalCode: "1100", startDate: "2025-06-02", endDate: null, status: "active" })).toEqual([]);
    expect(changedFields(input, { legalFirstName: "Other", city: "Quezon City" })).toContain("legalFirstName");
    const noCity = norm({ "custom_fields:City": "" }).input!;
    expect(changedFields(noCity, { city: "Somewhere" })).not.toContain("city");
  });
});
