// A fake TalentHR export with the same 45 columns as the real one. Every name, email, number and address is invented. Never put a real
// export in the repository or in a test.

export const TALENTHR_HEADERS = [
  "Employee ID *", "First Name *", "Last Name *", "Email *", "Supervisor ID *", "Hire Date", "Termination Date", "Employment Status", "Working Hours", "Working Days",
  "Department", "Location", "Division", "Job Title", "Employment Type", "Pay Rate *", "Pay Rate Currency", "Pay Rate Period *", "Pay Schedule", "Overtime Status",
  "Reason For Change", "Time Off Approver 1 (Supervisor) - Required", "Time Off Approver 2 ID", "Time Off Approver 2 - Required", "Time Off Approver 3 ID", "Time Off Approver 3 - Required",
  "custom_fields:Address", "custom_fields:City", "custom_fields:Postal code", "custom_fields:Country", "custom_fields:Employee number", "custom_fields:Marital status",
  "custom_fields:Citizenship", "custom_fields:Avatar", "custom_fields:Gender", "custom_fields:Birth date", "custom_fields:Phone", "custom_fields:Emergency contact full name",
  "custom_fields:Emergency contact phone", "custom_fields:Emergency contact address", "custom_fields:Emergency contact relationship", "custom_fields:Shirt size",
  "custom_fields:Compensation and Benefits", "custom_fields:Notes", "custom_fields:Onboarding date",
] as const;

export type FakePerson = Partial<Record<(typeof TALENTHR_HEADERS)[number], string>>;

export function fakePerson(n: number, over: FakePerson = {}): FakePerson {
  return {
    "Employee ID *": String(1000 + n),
    "First Name *": `Test${n}`,
    "Last Name *": `Person${n}`,
    "Email *": `import.person${n}@example.com`,
    "Supervisor ID *": "1001",
    "Hire Date": "06/02/2025",
    "Employment Status": "Contractor",
    Department: "Scribe",
    Location: "Manila",
    Division: "Asia",
    "Job Title": "Medical Scribe",
    "Pay Rate *": "12000.00",
    "Pay Rate Currency": "PHP",
    "Pay Rate Period *": "Month",
    "custom_fields:Address": `${n} Sample Street`,
    "custom_fields:City": "Quezon City",
    "custom_fields:Postal code": "1100",
    "custom_fields:Country": "Philippines",
    "custom_fields:Marital status": "Single",
    "custom_fields:Gender": "Female",
    "custom_fields:Birth date": "03/10/1990",
    "custom_fields:Phone": `+63 917 000 ${String(1000 + n)}`,
    "custom_fields:Emergency contact full name": `Contact ${n}`,
    "custom_fields:Emergency contact phone": `+63 917 111 ${String(1000 + n)}`,
    "custom_fields:Emergency contact relationship": "Sibling",
    "custom_fields:Shirt size": "4",
    "custom_fields:Compensation and Benefits": "Should never be imported by default",
    ...over,
  };
}

const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV text for these people, with every column present. */
export function toCsv(people: FakePerson[]): string {
  const lines = [TALENTHR_HEADERS.map((h) => quote(h)).join(",")];
  for (const p of people) lines.push(TALENTHR_HEADERS.map((h) => quote(p[h] ?? "")).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** A small company: a head (1001), two managers and staff, one terminated. `tag` makes the emails unique per test. */
export function fakeCompany(tag: string): FakePerson[] {
  const e = (n: number) => `${tag}.person${n}@example.com`;
  return [
    fakePerson(1, { "Email *": e(1), "Supervisor ID *": "", "Job Title": "Operations Director", Department: "Leadership" }),
    fakePerson(2, { "Email *": e(2), "Supervisor ID *": "1001", "Job Title": "Team Lead", Department: "Scribe" }),
    fakePerson(3, { "Email *": e(3), "Supervisor ID *": "1002" }),
    fakePerson(4, { "Email *": e(4), "Supervisor ID *": "1002", "Pay Rate Currency": "HNL", "custom_fields:Country": "Honduras" }),
    fakePerson(5, { "Email *": e(5), "Supervisor ID *": "1002", "Employment Status": "Terminated", "Termination Date": "03/24/2026" }),
  ];
}
