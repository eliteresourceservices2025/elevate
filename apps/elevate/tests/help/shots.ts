import type { Locator, Page } from "@playwright/test";

// The screenshots the Help center guides use. One entry = one picture, saved as content/help/assets/<article>/<file>.png and used in the
// guide as ![alt](help:<article>/<file>.png). Run `pnpm help:shots` to take them all again after the screens change, or
// `HELP_ONLY=invite-a-person pnpm help:shots` (an article name, comma separated for several) to take just some.
//
// Everything is captured against the LOCAL database with fake people (see playwright.help.config.ts). Never run it against production.

export type RoleKey = "super_admin" | "hr_admin" | "team_lead" | "recruiter" | "employee";

export type Shot = {
  /** The guide's file name without .md: also the folder the picture is saved in. */
  article: string;
  /** File name without .png; start it with the step number so the pictures sort in reading order. */
  file: string;
  /** What the picture shows, for people who cannot see it. Becomes the caption. */
  alt: string;
  /** Whose view: the page is opened as a signed-in person holding this role. */
  role: RoleKey;
  /** The address to open. A function gets the page, for addresses that depend on the data (for example the first person in the list). */
  path: string | ((page: Page) => Promise<string>);
  /** A taller or wider window for pictures that need more of the screen (the whole left menu, for example). Default 1280x800. */
  viewport?: { width: number; height: number };
  /** A part of the page that must be visible before the picture is taken. */
  ready?: (page: Page) => Locator;
  /** Steps to take after the page opens: open a menu, a dialog, type into a box. */
  prepare?: (page: Page) => Promise<void>;
  /** Parts of the page to draw a gold frame around, so the reader sees where to click. */
  highlight?: (page: Page) => Locator[];
};

/** The address of the first person in the People list (the seed gives the list fake names). */
export const firstPersonPath = async (page: Page) => {
  await page.goto("/people");
  const href = await page.locator("main a[href^='/people/']").evaluateAll((links) =>
    links.map((a) => a.getAttribute("href") ?? "").find((h) => /^\/people\/[0-9a-f-]{36}$/.test(h)),
  );
  if (!href) throw new Error("No person in the People list. Run pnpm db:seed first.");
  return href;
};

/** The address of the first link on a list page whose address matches the pattern (a case, a job, an applicant). */
export const firstLinkTo = (list: string, pattern: RegExp) => async (page: Page) => {
  await page.goto(list);
  await page.locator("main a").first().waitFor();
  const hrefs = await page.locator("main a").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  const href = hrefs.find((h) => pattern.test(h));
  if (!href) throw new Error(`No link on ${list} matches ${pattern}. Is the demo data there?`);
  return href;
};

/** The address of the job board with this title. */
export const jobPath = (title: string) => async (page: Page) => {
  await page.goto("/recruiting");
  const link = page.getByRole("link", { name: title }).first();
  await link.waitFor();
  return (await link.getAttribute("href"))!;
};

/** The address of an applicant page for the named person, found through the job board. */
export const applicantPath = (name: string) => async (page: Page) => {
  await page.goto("/recruiting");
  await page.locator("main a").first().waitFor();
  const jobs = [...new Set((await page.locator("main a").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))).filter((h) => /^\/recruiting\/[0-9a-f-]{36}$/.test(h)))];
  for (const job of jobs) {
    await page.goto(job);
    await page.locator("section[data-stage]").first().waitFor();
    const link = page.getByRole("link", { name }).first();
    if (await link.count()) return (await link.getAttribute("href"))!;
  }
  throw new Error(`${name} is not on any job board. Is the demo data there?`);
};

export const SHOTS: Shot[] = [
  // Getting started
  {
    article: "find-your-way-around",
    file: "01-menu",
    alt: "The left menu groups the pages by topic.",
    role: "employee",
    viewport: { width: 1280, height: 1100 },
    path: "/dashboard",
    ready: (p) => p.getByRole("link", { name: "Dashboard" }).first(),
    highlight: (p) => [p.getByRole("link", { name: "Help center" })],
  },
  {
    article: "ask-for-help",
    file: "01-contact-support",
    alt: "Open Contact support, then click Send a request to support.",
    role: "employee",
    path: "/support",
    ready: (p) => p.getByRole("heading", { name: "Contact support", level: 1 }),
    highlight: (p) => [p.getByRole("button", { name: "Send a request to support" })],
  },
  {
    article: "ask-for-help",
    file: "02-support-form",
    alt: "The support form: choose a topic, add a short title and the details.",
    role: "employee",
    path: "/support",
    ready: (p) => p.getByRole("button", { name: "Send a request to support" }),
    prepare: async (p) => {
      await p.getByRole("button", { name: "Send a request to support" }).click();
      await p.getByLabel("What is it about?").waitFor();
    },
  },

  // People
  {
    article: "invite-a-person",
    file: "01-invitations",
    alt: "Settings, Invitations: type the email and click Invite.",
    role: "hr_admin",
    path: "/settings/invitations",
    ready: (p) => p.getByLabel("Invite by email"),
    highlight: (p) => [p.getByLabel("Invite by email"), p.getByRole("button", { name: "Invite", exact: true })],
  },
  {
    article: "find-a-profile",
    file: "01-people-list",
    alt: "The People list. Search by name, then click a person.",
    role: "hr_admin",
    path: "/people",
    ready: (p) => p.getByPlaceholder("Search people"),
    highlight: (p) => [p.getByPlaceholder("Search people")],
  },
  {
    article: "find-a-profile",
    file: "02-profile-tabs",
    alt: "A profile has tabs: Personal, Employment, Documents and more.",
    role: "hr_admin",
    path: firstPersonPath,
    ready: (p) => p.getByRole("tab", { name: "Employment" }).or(p.getByRole("link", { name: "Employment" })).first(),
    highlight: (p) => [p.getByRole("navigation", { name: "Profile sections" })],
  },
  {
    article: "add-or-edit-a-person",
    file: "01-add-person",
    alt: "The Add person form.",
    role: "hr_admin",
    path: "/people/new",
    ready: (p) => p.getByLabel("Legal first name"),
  },
  {
    article: "set-who-reports-to-whom",
    file: "01-employment-tab",
    alt: "The Employment tab, where the manager, team and attendance lead are set.",
    role: "hr_admin",
    path: async (p) => `${await firstPersonPath(p)}?tab=employment`,
    ready: (p) => p.getByText("Team and manager").first(),
  },
  {
    article: "archive-someone",
    file: "01-more-actions",
    alt: "On the profile, open More actions and choose Archive.",
    role: "hr_admin",
    path: firstPersonPath,
    ready: (p) => p.getByRole("button", { name: "More actions" }),
    prepare: async (p) => {
      await p.getByRole("button", { name: "More actions" }).click();
      await p.getByRole("menuitem", { name: "Archive" }).waitFor();
    },
  },

  // Onboarding and offboarding
  {
    article: "start-onboarding",
    file: "01-onboarding-page",
    alt: "The Onboarding page lists people in onboarding and lets HR start a checklist.",
    role: "hr_admin",
    path: "/onboarding",
    ready: (p) => p.getByRole("heading", { name: "Onboarding", level: 1 }),
  },
  {
    article: "edit-checklist-templates",
    file: "01-templates",
    alt: "Checklist templates: one default list, and one per position if you want.",
    role: "hr_admin",
    path: "/onboarding/templates",
    ready: (p) => p.getByRole("heading", { name: "Checklist templates", level: 1 }),
  },
  {
    article: "offboard-someone",
    file: "01-offboarding-page",
    alt: "The Offboarding page, where you start an offboarding.",
    role: "hr_admin",
    path: "/offboarding",
    ready: (p) => p.getByRole("heading", { name: "Offboarding", level: 1 }),
  },

  // Recruiting
  {
    article: "post-a-job",
    file: "01-recruiting-page",
    alt: "The Recruiting page lists your jobs and applicants.",
    role: "hr_admin",
    path: "/recruiting",
    ready: (p) => p.getByRole("heading", { name: "Recruiting", level: 1 }),
  },
  {
    article: "post-a-job",
    file: "02-new-job",
    alt: "The New job form. A job starts as a draft.",
    role: "hr_admin",
    path: "/recruiting/new",
    ready: (p) => p.getByLabel("Job title"),
  },
  {
    article: "post-a-job",
    file: "03-careers-page",
    alt: "Edit the careers page title, introduction and banner.",
    role: "hr_admin",
    path: "/recruiting/careers-page",
    ready: (p) => p.getByRole("heading", { name: "Careers page", level: 1 }),
  },
  {
    article: "send-an-offer",
    file: "01-offer-templates",
    alt: "Offer templates: the letter and the fields that fill in by themselves.",
    role: "hr_admin",
    path: "/recruiting/offer-templates",
    ready: (p) => p.getByRole("heading", { name: "Offer templates", level: 1 }),
  },

  // Time and attendance
  {
    article: "team-attendance",
    file: "01-team-attendance",
    alt: "Team attendance: who is working now, flags and end-of-day reports.",
    role: "hr_admin",
    path: "/team-attendance",
    ready: (p) => p.getByRole("heading", { name: "Team attendance", level: 1 }),
  },
  {
    article: "approve-weekly-hours",
    file: "01-hours-review",
    alt: "Hours review: check each week and approve it.",
    role: "hr_admin",
    path: "/hours-review",
    ready: (p) => p.getByRole("heading", { name: "Hours review", level: 1 }),
  },
  {
    article: "approve-a-time-correction",
    file: "01-corrections",
    alt: "The Corrections tab on the Attendance page.",
    role: "hr_admin",
    path: "/attendance?tab=corrections",
    ready: (p) => p.getByRole("heading", { name: "Attendance", level: 1 }),
  },
  {
    article: "decide-extra-hours",
    file: "01-extra-hours",
    alt: "The Extra hours page, with the requests to review.",
    role: "hr_admin",
    path: "/extra-hours",
    ready: (p) => p.getByRole("heading", { name: "Extra hours", level: 1 }),
  },
  {
    article: "export-hours-for-payroll",
    file: "01-hours-export",
    alt: "The Hours export tab: choose the pay period and download.",
    role: "hr_admin",
    path: "/attendance?tab=export",
    ready: (p) => p.getByText("Export hours for payroll").first(),
  },
  {
    article: "check-the-jibble-link",
    file: "01-jibble",
    alt: "The Jibble page shows the connection and the people who are not matched.",
    role: "hr_admin",
    path: "/jibble",
    ready: (p) => p.getByRole("heading", { name: "Jibble", level: 1 }),
  },

  // Time off and schedules
  {
    article: "decide-a-time-off-request",
    file: "01-time-off",
    alt: "The Time off page with its tabs. Approvals holds the requests waiting for you.",
    role: "hr_admin",
    path: "/time-off",
    ready: (p) => p.getByRole("heading", { name: "Time off", level: 1 }),
  },
  {
    article: "award-prize-days",
    file: "01-award",
    alt: "The Award tab: choose the person, the days and the reason.",
    role: "hr_admin",
    path: "/time-off?tab=award",
    ready: (p) => p.getByRole("heading", { name: "Time off", level: 1 }),
  },
  {
    article: "set-and-import-schedules",
    file: "01-schedules",
    alt: "The Schedules page: tick people, then set a schedule.",
    role: "hr_admin",
    path: "/schedules",
    ready: (p) => p.getByRole("heading", { name: "Schedules", level: 1 }),
  },
  {
    article: "set-and-import-schedules",
    file: "02-import-schedules",
    alt: "Import schedules and clients from the attendance sheet.",
    role: "hr_admin",
    path: "/settings/import-schedules",
    ready: (p) => p.getByRole("heading", { name: "Import schedules and clients", level: 1 }),
  },

  // Documents and signing
  {
    article: "upload-and-sort-documents",
    file: "01-documents",
    alt: "The Documents page: files that are missing, to verify, or expiring.",
    role: "hr_admin",
    path: "/documents",
    ready: (p) => p.getByRole("heading", { name: "Documents", level: 1 }),
  },
  {
    article: "post-announcements-and-policies",
    file: "01-announcements",
    alt: "Announcements, with the Policies and Pop-up queue tabs.",
    role: "hr_admin",
    path: "/announcements",
    ready: (p) => p.getByRole("heading", { name: "Announcements", level: 1 }),
  },
  {
    article: "send-a-document-to-sign",
    file: "01-signing",
    alt: "The Signing page: documents to sign, all documents and templates.",
    role: "hr_admin",
    path: "/signing",
    ready: (p) => p.getByRole("heading", { name: "Signing", level: 1 }),
  },
  {
    article: "send-a-document-to-sign",
    file: "02-send-a-document",
    alt: "Send a document: choose the file, who signs and the order.",
    role: "hr_admin",
    path: "/signing/new",
    ready: (p) => p.getByRole("heading", { name: "Send a document", level: 1 }),
  },

  // Reports
  {
    article: "read-the-analytics-page",
    file: "01-analytics",
    alt: "Analytics shows totals only, and hides groups under 5 people.",
    role: "hr_admin",
    path: "/analytics",
    ready: (p) => p.getByRole("heading", { name: "Analytics", level: 1 }),
  },
  {
    article: "assets-and-certificates",
    file: "01-assets",
    alt: "Assets: the inventory and who has what.",
    role: "hr_admin",
    path: "/assets",
    ready: (p) => p.getByRole("heading", { name: "Assets", level: 1 }),
  },
  {
    article: "assets-and-certificates",
    file: "02-certificates",
    alt: "Certificates that expire, with reminders.",
    role: "hr_admin",
    path: "/credentials",
    ready: (p) => p.getByRole("heading", { name: "Certificates", level: 1 }),
  },

  // Settings
  {
    article: "roles-and-access",
    file: "01-roles",
    alt: "Roles and access: choose a person's roles and save.",
    role: "super_admin",
    path: "/settings/roles",
    ready: (p) => p.getByRole("heading", { name: "Roles and access", level: 1 }),
  },
  {
    article: "handle-support-requests",
    file: "01-support-inbox",
    alt: "The support inbox, with the open requests.",
    role: "hr_admin",
    path: "/support",
    ready: (p) => p.getByRole("heading", { name: "Contact support", level: 1 }),
  },
  {
    article: "handle-privacy-incidents",
    file: "01-incidents",
    alt: "Privacy incidents: report one, or handle the ones in the inbox.",
    role: "hr_admin",
    path: "/incidents",
    ready: (p) => p.getByRole("heading", { name: "Privacy incidents", level: 1 }),
  },

  // Pictures that need demo data or an open dialog
  {
    article: "start-onboarding",
    file: "02-start-dialog",
    alt: "Start onboarding: tick the people and choose the start date.",
    role: "hr_admin",
    path: "/onboarding",
    ready: (p) => p.getByRole("button", { name: "Start onboarding", exact: true }).first(),
    prepare: async (p) => {
      await p.getByRole("button", { name: "Start onboarding", exact: true }).first().click();
      await p.getByLabel("Search people").waitFor();
    },
  },
  {
    article: "start-onboarding",
    file: "03-case",
    alt: "A person's onboarding checklist: who owns each task and what is done.",
    role: "hr_admin",
    path: firstLinkTo("/onboarding", /^\/onboarding\/[0-9a-f-]{36}$/),
    ready: (p) => p.getByText("Mark done").first(),
  },
  {
    article: "offboard-someone",
    file: "02-start-dialog",
    alt: "Start an offboarding: tick the person, then set the last working day and the reason.",
    role: "hr_admin",
    path: "/offboarding",
    ready: (p) => p.getByRole("button", { name: "Start an offboarding" }).first(),
    prepare: async (p) => {
      await p.getByRole("button", { name: "Start an offboarding" }).first().click();
      await p.getByLabel("Search people").waitFor();
    },
  },
  {
    article: "offboard-someone",
    file: "03-case",
    alt: "An offboarding case: the checklist, and the HR actions such as Remove access now.",
    role: "hr_admin",
    path: firstLinkTo("/offboarding", /^\/offboarding\/[0-9a-f-]{36}$/),
    ready: (p) => p.getByText("HR actions").first(),
  },
  {
    article: "post-a-job",
    file: "04-job-pipeline",
    alt: "A job's pipeline: one column for each stage.",
    role: "hr_admin",
    path: jobPath("Virtual Assistant, Medical Billing"),
    ready: (p) => p.locator("section[data-stage='applied']").first(),
  },
  {
    article: "review-applications",
    file: "01-pipeline",
    alt: "The pipeline. Drag a card to another column, or use Move to.",
    role: "hr_admin",
    path: jobPath("Virtual Assistant, Medical Billing"),
    ready: (p) => p.locator("section[data-stage='applied']").first(),
  },
  {
    article: "review-applications",
    file: "02-applicant",
    alt: "An applicant's page: resume, notes, interviews and history.",
    role: "hr_admin",
    path: applicantPath("Mark Anthony Ramos"),
    ready: (p) => p.getByRole("heading", { name: "Mark Anthony Ramos" }),
  },
  {
    article: "interviews-and-scorecards",
    file: "01-schedule",
    alt: "Schedule an interview: type, date and time, length, place and interviewers.",
    role: "hr_admin",
    path: applicantPath("Liza Mercado"),
    ready: (p) => p.getByRole("heading", { name: "Liza Mercado" }),
    prepare: async (p) => {
      await p.getByText("Schedule an interview").first().click();
      await p.getByLabel("Meeting link or place").scrollIntoViewIfNeeded();
    },
  },
  {
    article: "send-an-offer",
    file: "02-offer-panel",
    alt: "On an applicant at the Offer stage, open Make an offer.",
    role: "hr_admin",
    path: applicantPath("Carla Fernandez"),
    ready: (p) => p.getByText("Offer and hiring").first(),
    prepare: async (p) => {
      await p.getByText("Make an offer").first().click();
      await p.getByLabel("Pay note (free text, shown in the letter)").scrollIntoViewIfNeeded();
    },
  },
  {
    article: "decide-a-time-off-request",
    file: "02-approvals",
    alt: "The Approvals tab: read the request, then Approve or Decline.",
    role: "hr_admin",
    path: "/time-off?tab=approvals",
    ready: (p) => p.getByRole("button", { name: "Approve" }).first(),
  },
  {
    article: "decide-extra-hours",
    file: "02-requests-to-review",
    alt: "Requests to review: the client, the time window, the reason and the proof.",
    role: "hr_admin",
    path: "/extra-hours",
    ready: (p) => p.getByText("Requests to review").first(),
  },
  {
    article: "approve-weekly-hours",
    file: "02-approve-week",
    alt: "Open Days to see each day, then click Approve week.",
    role: "hr_admin",
    path: "/hours-review",
    ready: (p) => p.getByRole("button", { name: "Approve week" }).first(),
    prepare: async (p) => {
      await p.getByText("Days (5)").nth(1).click();
    },
    highlight: (p) => [p.getByRole("button", { name: "Approve week" }).nth(1)],
  },
  {
    article: "upload-and-sort-documents",
    file: "02-person-documents",
    alt: "A person's Documents tab: folders, the list of files and the upload buttons.",
    role: "hr_admin",
    path: async (p) => `${await firstPersonPath(p)}?tab=documents`,
    ready: (p) => p.getByRole("heading", { name: "Documents" }).or(p.getByText("Upload")).first(),
  },
  {
    article: "bulk-upload-documents",
    file: "01-bulk-upload",
    alt: "Upload many files: drag them into the box, then click Upload files.",
    role: "hr_admin",
    path: async (p) => `${await firstPersonPath(p)}?tab=documents`,
    ready: (p) => p.getByText("Upload many files").first(),
    highlight: (p) => [p.getByText("Upload many files").first()],
  },
  {
    article: "post-announcements-and-policies",
    file: "02-new-announcement",
    alt: "The New announcement form: title, message and who it is for.",
    role: "hr_admin",
    path: "/announcements/new",
    ready: (p) => p.getByLabel("Title"),
  },
  {
    article: "assets-and-certificates",
    file: "03-register-item",
    alt: "Register an item: tag, name, category and serial number.",
    role: "hr_admin",
    path: "/assets",
    ready: (p) => p.getByRole("button", { name: "Register an item" }).first(),
    prepare: async (p) => {
      await p.getByRole("button", { name: "Register an item" }).first().click();
      await p.getByLabel("Asset tag").waitFor();
    },
  },
];
