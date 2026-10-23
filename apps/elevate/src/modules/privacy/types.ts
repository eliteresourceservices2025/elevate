// Shape of the "My data" export. Plain data: safe for the JSON download, the PDF and the page.

export type MyData = {
  generatedAt: string;
  account: { email: string };
  /** Null for an account that has no people record. */
  profile: {
    employeeNumber: string;
    legalFirstName: string;
    legalMiddleName: string | null;
    legalLastName: string;
    preferredName: string | null;
    birthDate: string | null;
    civilStatus: string | null;
    workEmail: string;
    personalEmail: string | null;
    mobile: string | null;
    address: string | null;
    status: string;
    workerType: string;
    position: string | null;
    team: string | null;
    manager: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null;
  /** Masked only (for example "•••• 1234"). Real values are revealed on the profile, which is audited. */
  sensitive: { field: string; label: string; masked: string | null }[];
  history: { date: string; event: string; summary: string }[];
  emergencyContacts: { name: string; relationship: string; phone: string; primary: boolean }[];
  clients: { client: string; startDate: string; endDate: string | null; hoursPerWeek: string | null }[];
  documents: { title: string; type: string; expiresOn: string | null; verified: boolean; uploadedAt: string }[];
  acknowledgments: { title: string; kind: string; version: number | null; at: string }[];
  /** Training from ELEVATE Learn: dates, status, time and certificate references. Never answers or question text. */
  training: { course: string; track: string; status: string; assignedOn: string; dueOn: string; passedOn: string | null; minutesSpent: number; certificate: string | null; validUntil: string | null }[];
  /** Quarterly practice answers from ELEVATE Learn: the quarter and whether the better answer was chosen. A nudge, never a score. */
  practice: { course: string; quarter: string; choseBetter: boolean }[];
  requests: { category: string; status: string; createdAt: string }[];
  activity: { at: string; action: string; by: string }[];
};
