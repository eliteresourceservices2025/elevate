import type { Locator, Page } from "@playwright/test";

// The screenshots the Help center guides use. One entry = one picture, saved as content/help/assets/<article>/<file>.png and used in the
// guide as ![alt](help:<article>/<file>.png). Run `pnpm help:shots` to take them all again after the screens change, or
// `HELP_ONLY=invite-a-person pnpm help:shots` (an article name, comma separated for several) to take just some.
//
// Everything is captured against the LOCAL database with fake people (see playwright.help.config.ts). Never run it against production.

/** Where the Safe Voice site runs (apps/safe-voice; port 3100 with its dev server). Start it before taking its pictures. */
export const SAFE_VOICE_URL = process.env.SAFEVOICE_URL ?? "http://localhost:3100";

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
  /** For another site (Safe Voice): open it in a clean browser with no sign-in and no cookies, so nothing from ELEVATE is sent to it. */
  anonymous?: boolean;
  /** The address to open. A function gets the page, for addresses that depend on the data (for example the first person in the list). */
  path: string | ((page: Page) => Promise<string>);
  /** A taller or wider window for pictures that need more of the screen (the whole left menu, for example). Default 1280x800. */
  viewport?: { width: number; height: number };
  /** A part of the page that must be visible before the picture is taken. */
  ready?: (page: Page) => Locator;
  /** Steps to take after the page opens: open a menu, a dialog, type into a box. */
  prepare?: (page: Page) => Promise<void>;
  /** Named parts of the page whose position is saved (content/help/assets/_boxes.json) so a video can zoom to them: "Invite button": (p) => p.getByRole(...). A part that is not on the screen is reported, not an error. */
  targets?: Record<string, (page: Page) => Locator>;
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
export const jobPath = (title: string) => async (page: Page) => `/recruiting/${await jobIdByTitle(page, title)}`;

/** The id of the job with this title, read from the job choice on the Applicants page (so it works however many other jobs exist). */
const jobIdByTitle = async (page: Page, title: string) => {
  await page.goto("/recruiting/applicants");
  const option = page.locator("#ap-job option", { hasText: title }).first();
  await option.waitFor({ state: "attached" });
  return (await option.getAttribute("value"))!;
};

/** The Applicants page narrowed to one job, so only that job's demo people show. */
export const applicantsOf = (title: string) => async (page: Page) => `/recruiting/applicants?job=${await jobIdByTitle(page, title)}`;

/** The address of an applicant page, found by searching the Applicants page for the name. */
export const applicantByName = (name: string) => async (page: Page) => {
  await page.goto(`/recruiting/applicants?q=${encodeURIComponent(name)}`);
  const link = page.getByRole("link", { name }).first();
  await link.waitFor();
  return (await link.getAttribute("href"))!;
};

/** The address of an applicant page for the named person (kept under its old name for the older pictures). */
export const applicantPath = applicantByName;

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
    targets: { "email box": (p) => p.getByLabel("Invite by email"), "Invite button": (p) => p.getByRole("button", { name: "Invite", exact: true }), "list": (p) => p.getByRole("table") },
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
    viewport: { width: 1280, height: 1250 },
    targets: { "name": (p) => p.getByLabel("Legal first name"), "work email": (p) => p.getByLabel("Work email"), "employment": (p) => p.getByLabel("Position"), "manager": (p) => p.getByLabel("Manager"), "Add person button": (p) => p.getByRole("button", { name: "Add person" }) },
    alt: "The Add person form.",
    role: "hr_admin",
    path: "/people/new",
    ready: (p) => p.getByLabel("Legal first name"),
  },
  {
    article: "set-who-reports-to-whom",
    file: "01-employment-tab",
    viewport: { width: 1280, height: 1300 },
    targets: { "employment card": (p) => p.getByText("Employment", { exact: true }).nth(1), "reporting": (p) => p.getByText("Reporting", { exact: true }).first(), "team and manager": (p) => p.getByText("Team and manager").first(), "attendance lead": (p) => p.getByText("Attendance lead").first() },
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
    targets: { "Start onboarding button": (p) => p.getByRole("button", { name: "Start onboarding", exact: true }).first(), "list": (p) => p.getByRole("table"), "Checklist templates": (p) => p.getByRole("link", { name: "Checklist templates" }) },
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
    viewport: { width: 1280, height: 1500 },
    targets: { "job title": (p) => p.getByLabel("Job title"), "description": (p) => p.getByLabel(/^Description/), "pay note": (p) => p.getByLabel(/^Pay note/), "hiring team": (p) => p.getByText("Hiring team").first(), "create button": (p) => p.getByRole("button", { name: "Create job (draft)" }) },
    alt: "The New job form. A job starts as a draft.",
    role: "hr_admin",
    path: "/recruiting/new",
    ready: (p) => p.getByLabel("Job title"),
  },
  {
    article: "post-a-job",
    file: "03-careers-page",
    targets: { "page title": (p) => p.getByLabel("Page title"), "introduction": (p) => p.getByLabel("Introduction"), "banner": (p) => p.getByText("Banner", { exact: true }).first() },
    alt: "Edit the careers page title, introduction and banner.",
    role: "hr_admin",
    path: "/recruiting/careers-page",
    ready: (p) => p.getByRole("heading", { name: "Careers page", level: 1 }),
  },
  {
    article: "send-an-offer",
    file: "01-offer-templates",
    targets: { "merge fields": (p) => p.getByText("Merge fields you can use").first(), "letter": (p) => p.getByText("Letter", { exact: true }).first(), "template name": (p) => p.getByLabel("Template name"), "save": (p) => p.getByRole("button", { name: /template$/ }).first() },
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
    targets: { "week": (p) => p.getByText(/^Week of/).first(), "Previous": (p) => p.getByRole("button", { name: "Previous" }), "Next": (p) => p.getByRole("button", { name: "Next" }), "Approve everyone": (p) => p.getByRole("button", { name: "Approve everyone without flags" }), "table": (p) => p.getByRole("table").first(), "flags": (p) => p.getByText("Flags", { exact: true }).first(), "first row": (p) => p.getByText("Andrea Bell").first() },
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
    targets: { "progress note": (p) => p.getByText(/finished days are not approved yet/).first(), "pay period": (p) => p.getByLabel("Pay period"), "include box": (p) => p.getByLabel(/Also include days that are not approved/), "daily": (p) => p.getByRole("button", { name: "Download daily detail (CSV)" }), "summary": (p) => p.getByRole("button", { name: "Download per-person summary (CSV)" }), "pay periods": (p) => p.getByText("How pay periods are cut").first() },
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
    targets: { "Approvals tab": (p) => p.getByRole("link", { name: "Approvals" }), "Calendar tab": (p) => p.getByRole("link", { name: "Calendar" }), "Request time off": (p) => p.getByRole("button", { name: "Request time off" }).or(p.getByRole("link", { name: "Request time off" })).first() },
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
    viewport: { width: 1280, height: 1000 },
    targets: { "people": (p) => p.getByRole("table").first(), "Set a schedule": (p) => p.getByText("Set a schedule").first(), "in Manila": (p) => p.getByText("In Manila").first() },
    alt: "The Schedules page: tick people, then set a schedule.",
    role: "hr_admin",
    path: "/schedules",
    ready: (p) => p.getByRole("heading", { name: "Schedules", level: 1 }),
  },
  {
    article: "set-and-import-schedules",
    file: "02-import-schedules",
    targets: { "upload": (p) => p.getByText("Upload an attendance sheet").first(), "file types": (p) => p.getByText(/CSV or Excel/).first(), "earlier uploads": (p) => p.getByText("Earlier uploads").first() },
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
    targets: { "tabs": (p) => p.getByRole("link", { name: "All documents" }), "to sign": (p) => p.getByRole("link", { name: "To sign" }), "Templates": (p) => p.getByRole("link", { name: "Templates" }), "send button": (p) => p.getByRole("link", { name: /Send a document|New document/ }).first() },
    alt: "The Signing page: documents to sign, all documents and templates.",
    role: "hr_admin",
    path: "/signing",
    ready: (p) => p.getByRole("heading", { name: "Signing", level: 1 }),
  },
  {
    article: "send-a-document-to-sign",
    file: "02-send-a-document",
    viewport: { width: 1280, height: 1700 },
    targets: { "title": (p) => p.getByLabel("Document title"), "the document": (p) => p.getByText("The document", { exact: true }).first(), "ready-made": (p) => p.getByLabel("Start from a ready-made document (optional)"), "who signs": (p) => p.getByText("Who signs", { exact: true }).first(), "signing order": (p) => p.getByText("Signing order").first(), "send button": (p) => p.getByRole("button", { name: "Send for signature" }) },
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
    targets: { "people list": (p) => p.getByRole("list", { name: "People to choose from" }), "search": (p) => p.getByLabel("Search people"), "start date": (p) => p.locator("#on-start"), "start button": (p) => p.getByRole("dialog").getByRole("button", { name: /^Start onboarding/ }) },
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
    targets: { "first task": (p) => p.getByText("Equipment is ready and issued").first(), "Mark done": (p) => p.getByRole("button", { name: "Mark done" }).first(), "Skip": (p) => p.getByRole("button", { name: "Skip" }).first(), "late tag": (p) => p.getByText("Late").first(), "automatic": (p) => p.getByText("ELEVATE ticks this when it is done.").first() },
    alt: "A person's onboarding checklist: who owns each task and what is done.",
    role: "hr_admin",
    path: firstLinkTo("/onboarding", /^\/onboarding\/[0-9a-f-]{36}$/),
    ready: (p) => p.getByText("Mark done").first(),
  },
  {
    article: "offboard-someone",
    file: "02-start-dialog",
    targets: { "people list": (p) => p.getByRole("list", { name: "People to choose from" }), "search": (p) => p.getByLabel("Search people") },
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
    targets: { "HR actions": (p) => p.getByText("HR actions").first(), "Remove access now": (p) => p.getByRole("button", { name: "Remove access now" }), "Cancel offboarding": (p) => p.getByRole("button", { name: "Cancel offboarding" }), "certificate": (p) => p.getByRole("button", { name: "Issue certificate of engagement" }), "first task": (p) => p.getByText("Write and hand over turnover notes").first(), "exit interview": (p) => p.getByText("Exit interview").first() },
    alt: "An offboarding case: the checklist, and the HR actions such as Remove access now.",
    role: "hr_admin",
    path: firstLinkTo("/offboarding", /^\/offboarding\/[0-9a-f-]{36}$/),
    ready: (p) => p.getByText("HR actions").first(),
  },
  {
    article: "post-a-job",
    file: "04-job-pipeline",
    targets: { "status": (p) => p.getByText("Open", { exact: true }).first(), "Close job": (p) => p.getByRole("button", { name: "Close job" }), "View job ad": (p) => p.getByRole("link", { name: /View job ad/ }), "Applied column": (p) => p.locator("section[data-stage='applied']").first() },
    alt: "A job's pipeline: one column for each stage.",
    role: "hr_admin",
    path: jobPath("Virtual Assistant, Medical Billing"),
    ready: (p) => p.locator("section[data-stage='applied']").first(),
  },
  {
    article: "review-applications",
    file: "01-pipeline",
    targets: { "Applied column": (p) => p.locator("section[data-stage='applied']").first(), "Screening column": (p) => p.locator("section[data-stage='screening']").first(), "Interview column": (p) => p.locator("section[data-stage='interview']").first(), "first card": (p) => p.locator("section[data-stage='applied']").first().getByRole("link").first(), "Move to menu": (p) => p.locator("section[data-stage='applied']").first().getByRole("combobox").first() },
    alt: "The pipeline. Drag a card to another column, or use Move to.",
    role: "hr_admin",
    path: jobPath("Virtual Assistant, Medical Billing"),
    ready: (p) => p.locator("section[data-stage='applied']").first(),
  },
  {
    article: "review-applications",
    file: "02-applicant",
    targets: { "applicant details": (p) => p.getByText("Applicant", { exact: true }).first(), "stage card": (p) => p.getByText("Stage", { exact: true }).first(), "Move to": (p) => p.getByLabel("Move to"), "Close this application": (p) => p.getByText("Close this application") },
    alt: "An applicant's page: details, keyword match, talent pool, source and tags, then the resume, notes, interviews and history.",
    viewport: { width: 1280, height: 1500 },
    role: "hr_admin",
    path: applicantPath("Mark Anthony Ramos"),
    ready: (p) => p.getByRole("heading", { name: "Mark Anthony Ramos" }),
  },
  // The applicants list and the tools around it
  {
    article: "find-applicants",
    file: "01-list",
    targets: { "Name or email": (p) => p.getByLabel("Name or email"), "Job": (p) => p.getByLabel("Job", { exact: true }), "Stage": (p) => p.getByLabel("Stage", { exact: true }), "Apply filters": (p) => p.getByRole("button", { name: "Apply filters" }), "More filters": (p) => p.getByText("More filters"), "Possible duplicates": (p) => p.getByRole("link", { name: "Possible duplicates" }), "Source and tags": (p) => p.getByRole("columnheader", { name: "Source and tags" }) },
    alt: "The Applicants page: filters on top, one row for each applicant.",
    role: "hr_admin",
    viewport: { width: 1280, height: 1000 },
    path: applicantsOf("Virtual Assistant, Medical Billing"),
    ready: (p) => p.getByRole("link", { name: "Joseph Miller" }).first(),
  },
  {
    article: "find-applicants",
    file: "02-more-filters",
    targets: { "How it closed": (p) => p.getByLabel("How it closed"), "Source": (p) => p.getByLabel("Source", { exact: true }), "Tag": (p) => p.getByLabel("Tag", { exact: true }), "Keyword match": (p) => p.getByLabel("Keyword match"), "Only the talent pool": (p) => p.getByLabel("Only the talent pool") },
    alt: "More filters: how it closed, source, tag, keyword match and the talent pool.",
    role: "hr_admin",
    viewport: { width: 1280, height: 1000 },
    path: applicantsOf("Virtual Assistant, Medical Billing"),
    ready: (p) => p.getByText("More filters"),
    prepare: async (p) => {
      await p.getByText("More filters").click();
      await p.getByLabel("Only the talent pool").waitFor();
    },
  },
  {
    article: "act-on-many-applicants",
    file: "01-bulk",
    targets: { "Select or clear this page": (p) => p.getByRole("button", { name: "Select or clear this page" }), "Do this": (p) => p.getByLabel("Do this"), "Tag": (p) => p.locator("#bulk-tag"), "Apply to": (p) => p.getByRole("button", { name: /^Apply to/ }) },
    alt: "Tick applicants, choose what to do, then click Apply.",
    role: "hr_admin",
    viewport: { width: 1280, height: 1000 },
    path: applicantsOf("Virtual Assistant, Medical Billing"),
    ready: (p) => p.getByRole("button", { name: "Select or clear this page" }),
    prepare: async (p) => {
      await p.getByLabel("Select Katrina Dela Cruz").first().check();
      await p.getByLabel("Select Joseph Miller").first().check();
      await p.getByLabel("Do this").selectOption("tag");
      await p.locator("#bulk-tag").selectOption({ index: 1 });
    },
  },
  {
    article: "tag-applicants-and-track-sources",
    file: "01-source-and-tags",
    targets: { "Heard about the job": (p) => p.getByLabel("Heard about the job"), "tags": (p) => p.getByText("Make a new tag") },
    alt: "On an applicant's page: where they heard about the job, and their tags.",
    role: "hr_admin",
    viewport: { width: 1280, height: 1100 },
    path: applicantByName("Joseph Miller"),
    ready: (p) => p.getByRole("heading", { name: "Source and tags" }),
  },
  {
    article: "keyword-match-resumes",
    file: "01-job-keywords",
    targets: { "Must have": (p) => p.locator("#op-kw-req"), "Nice to have": (p) => p.locator("#op-kw-nice") },
    alt: "On the job form: the words to look for in resumes.",
    role: "hr_admin",
    viewport: { width: 1280, height: 560 },
    path: async (p) => `/recruiting/${await jobIdByTitle(p, "Virtual Assistant, Medical Billing")}/edit`,
    ready: (p) => p.locator("#op-kw-req"),
    prepare: async (p) => {
      await p.locator("#op-kw-req").evaluate((el) => el.scrollIntoView({ block: "center" }));
    },
  },
  {
    article: "keyword-match-resumes",
    file: "02-keyword-match",
    targets: { "Found in the resume": (p) => p.getByText("Found in the resume"), "Not found": (p) => p.getByText("Not found", { exact: true }) },
    alt: "An applicant's keyword match: the percentage, the words found and the words missing.",
    role: "hr_admin",
    viewport: { width: 1280, height: 1100 },
    path: applicantByName("Katrina Dela Cruz"),
    ready: (p) => p.getByRole("heading", { name: "Keyword match" }),
  },
  {
    article: "talent-pool",
    file: "01-pool-panel",
    targets: { "Take out of the pool": (p) => p.getByRole("button", { name: "Take out of the pool" }), "another job": (p) => p.getByLabel("Also consider for another open job") },
    alt: "On an applicant's page: the talent pool panel.",
    role: "hr_admin",
    viewport: { width: 1280, height: 1100 },
    path: applicantByName("Joseph Miller"),
    ready: (p) => p.getByRole("heading", { name: "Talent pool" }),
  },
  {
    article: "merge-duplicate-applicants",
    file: "01-duplicates",
    alt: "Possible duplicates: records that look like the same person.",
    role: "hr_admin",
    viewport: { width: 1280, height: 900 },
    path: "/recruiting/applicants/duplicates",
    ready: (p) => p.getByRole("heading", { level: 1 }),
  },
  {
    article: "read-recruiting-reports",
    file: "01-reports",
    alt: "Recruiting reports: how far applications got, time in each stage, sources and how applications ended.",
    role: "hr_admin",
    viewport: { width: 1280, height: 1300 },
    path: async (p) => `/recruiting/reports?job=${await jobIdByTitle(p, "Virtual Assistant, Medical Billing")}`,
    ready: (p) => p.getByRole("heading", { level: 1 }),
  },
  {
    article: "reword-applicant-emails",
    file: "01-emails",
    alt: "Applicant emails: the built-in wording, and a place to write your own.",
    role: "hr_admin",
    viewport: { width: 1280, height: 1100 },
    path: "/recruiting/email-templates",
    ready: (p) => p.getByRole("heading", { level: 1 }),
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
    viewport: { width: 1280, height: 1250 },
    targets: { "stage": (p) => p.getByText("Stage", { exact: true }).first(), "Make an offer": (p) => p.getByText("Make an offer").first(), "template": (p) => p.getByLabel("Template"), "start date": (p) => p.getByLabel("Start date"), "pay note": (p) => p.getByLabel("Pay note (free text, shown in the letter)"), "countersigner": (p) => p.getByLabel(/^Countersigner/) },
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
    targets: { "Approvals tab": (p) => p.getByRole("link", { name: "Approvals" }), "first request": (p) => p.getByText("John Paul Wright").first(), "status": (p) => p.getByText("Waiting for HR").first(), "note box": (p) => p.getByLabel("Note (needed to decline)").first(), "Approve": (p) => p.getByRole("button", { name: "Approve" }).first(), "Decline": (p) => p.getByRole("button", { name: "Decline" }).first() },
    alt: "The Approvals tab: read the request, then Approve or Decline.",
    role: "hr_admin",
    path: "/time-off?tab=approvals",
    ready: (p) => p.getByRole("button", { name: "Approve" }).first(),
  },
  {
    article: "decide-extra-hours",
    file: "02-requests-to-review",
    viewport: { width: 1280, height: 1900 },
    targets: { "Requests to review": (p) => p.getByText("Requests to review").first(), "file form": (p) => p.getByText("File extra hours the client asked for").first(), "client": (p) => p.getByLabel("Client").first(), "from": (p) => p.getByLabel("From").first(), "reason": (p) => p.getByLabel("Reason").first(), "Approve": (p) => p.getByRole("button", { name: "Approve" }).first(), "Decline": (p) => p.getByRole("button", { name: "Decline" }).first(), "queue request": (p) => p.getByText("The client asked us to finish the month-end billing").first() },
    alt: "Requests to review: the client, the time window, the reason and the proof.",
    role: "hr_admin",
    path: "/extra-hours",
    ready: (p) => p.getByText("Requests to review").first(),
  },
  {
    article: "approve-weekly-hours",
    file: "02-approve-week",
    targets: { "second row": (p) => p.getByText("Bianca Mendoza").first(), "late flag": (p) => p.getByText("Late", { exact: true }).first(), "Approve week": (p) => p.getByRole("button", { name: "Approve week" }).nth(1), "days": (p) => p.getByText("Days (5)").nth(1) },
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

  // ---- Batch 2: what a person does for themselves (Employee view) ----
  {
    article: "clock-in-and-out",
    file: "01-clock",
    alt: "The time clock is at the top right of every page.",
    role: "employee",
    path: "/dashboard",
    ready: (p) => p.getByRole("button", { name: /Clock in/ }).first(),
    highlight: (p) => [p.getByRole("button", { name: /Clock in/ }).first()],
    targets: { "clock button": (p) => p.getByRole("button", { name: /Clock in/ }).first() },
  },
  {
    article: "clock-in-and-out",
    file: "02-my-time",
    alt: "My time, under Attendance, shows today and your week.",
    role: "employee",
    path: "/attendance",
    ready: (p) => p.getByRole("heading", { name: "Attendance", level: 1 }),
    targets: { "week": (p) => p.getByLabel("Week summary").first(), "tabs": (p) => p.getByRole("link", { name: "My time" }) },
  },
  {
    article: "set-up-your-clock",
    file: "01-clock-settings",
    alt: "Your clock settings: your time zone and the location option.",
    role: "employee",
    path: "/attendance",
    ready: (p) => p.getByRole("heading", { name: "Attendance", level: 1 }),
    prepare: async (p) => {
      await p.getByRole("button", { name: /clock settings/i }).first().click();
      await p.getByLabel("Your time zone").waitFor();
    },
    targets: { "time zone": (p) => p.getByLabel("Your time zone"), "location": (p) => p.getByLabel(/Record my approximate location/) },
  },
  {
    article: "ask-for-a-time-correction",
    file: "01-ask-correction",
    alt: "Ask for a time correction: choose what happened, say why and add a screenshot.",
    role: "employee",
    path: "/attendance",
    viewport: { width: 1280, height: 1100 },
    ready: (p) => p.getByRole("heading", { name: "Attendance", level: 1 }),
    prepare: async (p) => {
      await p.getByRole("button", { name: "Ask for a correction" }).first().click();
      await p.getByLabel("Reason").first().waitFor();
    },
    targets: { "reason": (p) => p.getByLabel("Reason").first(), "proof": (p) => p.getByLabel(/Screenshots as proof/).first() },
  },
  {
    article: "report-a-clock-problem",
    file: "01-report-issue",
    alt: "Report a technical issue: what went wrong, and a screenshot.",
    role: "employee",
    path: "/attendance",
    viewport: { width: 1280, height: 1100 },
    ready: (p) => p.getByRole("heading", { name: "Attendance", level: 1 }),
    prepare: async (p) => {
      await p.getByRole("button", { name: "Report a technical issue" }).first().click();
      await p.getByLabel("What went wrong?").waitFor();
    },
    targets: { "what went wrong": (p) => p.getByLabel("What went wrong?"), "screenshot": (p) => p.getByLabel(/Screenshot of the problem/) },
  },
  {
    article: "ask-for-extra-hours",
    file: "01-ask-extra-hours",
    alt: "Ask to work extra hours: the client, the time, who approved it, and a screenshot.",
    role: "employee",
    path: "/extra-hours",
    viewport: { width: 1280, height: 1300 },
    ready: (p) => p.getByRole("heading", { name: "Extra hours", level: 1 }),
    prepare: async (p) => {
      await p.getByText("Ask to work extra hours").first().click();
    },
    targets: { "client": (p) => p.getByLabel("Client").first(), "approved by": (p) => p.getByLabel("Who at the client approved it?"), "proof": (p) => p.getByLabel(/Screenshot of the client/).first() },
  },
  {
    article: "request-time-off",
    file: "01-prize-days",
    alt: "Time off: your prize days and your requests.",
    role: "employee",
    path: "/time-off",
    ready: (p) => p.getByRole("heading", { name: "Time off", level: 1 }),
    targets: { "tabs": (p) => p.getByRole("link", { name: "My prize days" }), "Request time off": (p) => p.getByRole("button", { name: "Request time off" }).or(p.getByRole("link", { name: "Request time off" })).first() },
  },
  {
    article: "request-time-off",
    file: "02-request-form",
    alt: "Request time off: leave type, first and last day, and a note.",
    role: "employee",
    path: "/time-off",
    viewport: { width: 1280, height: 1000 },
    ready: (p) => p.getByRole("heading", { name: "Time off", level: 1 }),
    prepare: async (p) => {
      await p.getByRole("button", { name: "Request time off" }).or(p.getByRole("link", { name: "Request time off" })).first().click();
      await p.getByLabel("First day").waitFor();
    },
    targets: { "leave type": (p) => p.getByLabel("Leave type"), "first day": (p) => p.getByLabel("First day"), "send": (p) => p.getByRole("button", { name: "Send request" }) },
  },
  {
    article: "see-your-schedule",
    file: "01-schedule",
    alt: "Your schedule, in your client's time and in Manila time.",
    role: "employee",
    path: "/schedules",
    ready: (p) => p.getByRole("heading", { name: "Schedules", level: 1 }),
    targets: { "my schedule": (p) => p.getByText("My schedule").first(), "in Manila": (p) => p.getByText("In Manila").first() },
  },
  {
    article: "update-your-profile",
    file: "01-profile",
    alt: "My profile: your photo, your details and the request links.",
    role: "employee",
    path: "/people/me",
    viewport: { width: 1280, height: 950 },
    ready: (p) => p.getByText("Add a photo").first(),
    targets: { "photo": (p) => p.getByText("Add a photo").first(), "contact request": (p) => p.getByText("Request a change to my contact details"), "about me": (p) => p.getByText("Edit about me").first(), "tabs": (p) => p.getByRole("navigation", { name: "Profile sections" }) },
  },
  {
    article: "update-your-profile",
    file: "02-contact-request",
    alt: "Request a change to your contact details. HR reviews it before it applies.",
    role: "employee",
    path: "/people/me",
    viewport: { width: 1280, height: 1150 },
    ready: (p) => p.getByText("Request a change to my contact details"),
    prepare: async (p) => {
      await p.getByText("Request a change to my contact details").click();
      await p.getByLabel("Mobile").waitFor();
    },
    targets: { "personal email": (p) => p.getByLabel("Personal email").last(), "mobile": (p) => p.getByLabel("Mobile").last() },
  },
  {
    article: "upload-your-documents",
    file: "01-documents",
    alt: "Your Documents tab: choose the type, add a title and the file, then Upload.",
    role: "employee",
    path: "/people/me?tab=documents",
    viewport: { width: 1280, height: 1300 },
    ready: (p) => p.getByText("Upload a document").first(),
    targets: { "document type": (p) => p.getByLabel("Document type"), "file": (p) => p.getByLabel("File").first(), "Upload many files": (p) => p.getByText("Upload many files").first(), "folder": (p) => p.getByRole("button", { name: "New folder" }) },
  },
  {
    article: "finish-your-onboarding",
    file: "01-onboarding",
    alt: "Your onboarding checklist: who owns each task and what is due.",
    role: "employee",
    path: "/onboarding",
    ready: (p) => p.getByText("Your tasks").first(),
    targets: { "your tasks": (p) => p.getByText("Your tasks").first(), "first task": (p) => p.getByText("Acknowledge the privacy notice").first(), "open link": (p) => p.getByRole("link", { name: "Open" }).first(), "your onboarding": (p) => p.getByText("Your onboarding").first(), "late tag": (p) => p.getByText(/late/).first() },
  },
  {
    article: "acknowledge-announcements-and-policies",
    file: "01-announcements",
    alt: "Announcements: the ones that need your acknowledgment are marked.",
    role: "employee",
    path: "/announcements",
    ready: (p) => p.getByRole("heading", { name: "Announcements", level: 1 }),
    targets: { "needs ack": (p) => p.getByText(/needs? your acknowledgment|Acknowledgment needed/).first(), "tabs": (p) => p.getByRole("link", { name: "Policies" }) },
  },
  {
    article: "acknowledge-announcements-and-policies",
    file: "02-acknowledge",
    alt: "Read it, then click I have read and understand.",
    role: "employee",
    path: firstLinkTo("/announcements", /^\/announcements\/[0-9a-f-]{36}$/),
    ready: (p) => p.getByRole("button", { name: "I have read and understand" }),
    targets: { "button": (p) => p.getByRole("button", { name: "I have read and understand" }) },
  },
  {
    article: "take-your-training",
    file: "01-my-training",
    alt: "My training: open your assigned course.",
    role: "employee",
    path: "/learn",
    ready: (p) => p.getByRole("heading", { name: "My training", level: 1 }),
    targets: { "open button": (p) => p.getByRole("link", { name: /Open HIPAA training/ }).or(p.getByRole("button", { name: /Open HIPAA training/ })).first() },
  },
  {
    article: "your-certificates-and-equipment",
    file: "01-certificates",
    alt: "My certificates, with the dates they end.",
    role: "employee",
    path: "/credentials",
    ready: (p) => p.getByRole("heading", { name: "Certificates", level: 1 }),
    targets: { "my certificates": (p) => p.getByText("My certificates").first() },
  },
  {
    article: "your-certificates-and-equipment",
    file: "02-assets",
    alt: "My assets: the equipment assigned to you.",
    role: "employee",
    path: "/assets",
    ready: (p) => p.getByRole("heading", { name: "Assets", level: 1 }),
    targets: { "my assets": (p) => p.getByText("My assets").first() },
  },
  {
    article: "your-reviews-and-goals",
    file: "01-reviews",
    alt: "Reviews: your reviews and your goals.",
    role: "employee",
    path: "/reviews",
    ready: (p) => p.getByRole("heading", { name: "Reviews", level: 1 }),
    targets: { "goals": (p) => p.getByRole("link", { name: "Goals" }), "your reviews": (p) => p.getByText("Your reviews").first() },
  },
  {
    article: "see-what-elevate-holds-about-you",
    file: "01-my-data",
    alt: "My data: everything ELEVATE holds about you, with downloads and a way to ask HR.",
    role: "employee",
    path: "/my-data",
    ready: (p) => p.getByRole("heading", { name: "My data", level: 1 }),
    targets: { "ask HR": (p) => p.getByText("Ask HR about your data").first(), "download": (p) => p.getByText("Download PDF").first(), "profile": (p) => p.getByText("Profile", { exact: true }).first() },
  },
  {
    article: "report-a-privacy-concern",
    file: "01-incidents",
    alt: "Privacy incidents: click Report an incident.",
    role: "employee",
    path: "/incidents",
    ready: (p) => p.getByRole("heading", { name: "Privacy incidents", level: 1 }),
    highlight: (p) => [p.getByText("Report an incident").first()],
    targets: { "report button": (p) => p.getByText("Report an incident").first() },
  },
  {
    article: "report-a-privacy-concern",
    file: "02-report-form",
    alt: "Say what happened, when, and what you have done. No patient details.",
    role: "employee",
    path: "/incidents",
    viewport: { width: 1280, height: 1400 },
    ready: (p) => p.getByText("Report an incident").first(),
    prepare: async (p) => {
      await p.getByText("Report an incident").first().click();
      await p.getByLabel("What happened?").waitFor();
    },
    targets: { "what happened": (p) => p.getByLabel("What happened?"), "send": (p) => p.getByRole("button", { name: "Send the report" }) },
  },
  {
    article: "read-the-org-chart",
    file: "01-org-chart",
    alt: "The org chart: the chart view and the list view.",
    role: "employee",
    path: "/org-chart",
    ready: (p) => p.getByRole("heading", { name: "Org chart", level: 1 }),
  },

  // ---- Batch 2: HR and leads ----
  {
    article: "merge-duplicate-records",
    file: "01-duplicates",
    alt: "Duplicate people: choose the record that stays, and merge by hand.",
    role: "hr_admin",
    path: "/people/duplicates",
    viewport: { width: 1280, height: 1000 },
    ready: (p) => p.getByText("Merge two records by hand").first(),
    targets: { "found": (p) => p.getByText("People who may be in the directory twice").first(), "by hand": (p) => p.getByText("Merge two records by hand").first(), "keep": (p) => p.getByText("Keep this record").first(), "merge into": (p) => p.getByText("Merge this one into it (it is archived)").first() },
  },
  {
    article: "review-a-change-request",
    file: "01-requests",
    alt: "Change requests: Pending, Approved and Rejected.",
    role: "hr_admin",
    path: "/people/requests",
    ready: (p) => p.getByRole("heading", { name: "Change requests", level: 1 }),
    targets: { "lists": (p) => p.getByText(/^Pending/).first() },
  },
  {
    article: "add-custom-fields",
    file: "01-fields",
    alt: "Custom fields: label, key, type, who can see it.",
    role: "hr_admin",
    path: "/people/fields",
    viewport: { width: 1280, height: 1000 },
    ready: (p) => p.getByRole("heading", { name: "Custom fields", level: 1 }),
    targets: { "label": (p) => p.getByLabel("Label"), "key": (p) => p.getByLabel("Key"), "type": (p) => p.getByLabel("Type"), "who sees": (p) => p.getByLabel("Who can see it"), "Add field": (p) => p.getByRole("button", { name: "Add field" }) },
  },
  {
    article: "set-up-departments-teams-and-positions",
    file: "01-structure",
    alt: "Structure: departments, teams and positions.",
    role: "hr_admin",
    path: "/people/structure",
    viewport: { width: 1280, height: 1500 },
    ready: (p) => p.getByRole("heading", { name: "Structure", level: 1 }),
    targets: { "departments": (p) => p.getByText("Departments", { exact: true }).first(), "teams": (p) => p.getByText("Teams", { exact: true }).first(), "positions": (p) => p.getByText("Positions", { exact: true }).first() },
  },
  {
    article: "manage-clients",
    file: "01-clients",
    alt: "Clients: name, time zone, holidays and whether they work with patient information.",
    role: "hr_admin",
    path: "/people/clients",
    viewport: { width: 1280, height: 1000 },
    ready: (p) => p.getByRole("heading", { name: "Clients", level: 1 }),
    targets: { "client name": (p) => p.getByLabel("Client name").first(), "patient info": (p) => p.getByLabel(/Works with patient information/).first(), "Add client": (p) => p.getByRole("button", { name: "Add client" }) },
  },
  {
    article: "set-team-clock-rules",
    file: "01-rules",
    alt: "Rules, per team: allowed IPs, idle prompt, grace and selfie.",
    role: "hr_admin",
    path: "/attendance?tab=rules",
    viewport: { width: 1280, height: 1250 },
    ready: (p) => p.getByText("Rules apply per team").first(),
    targets: { "allowed IPs": (p) => p.getByLabel("Allowed IP addresses or ranges (one per line)").first(), "idle prompt": (p) => p.getByLabel("Idle prompt after (minutes)").first(), "late grace": (p) => p.getByLabel("Late and early-leave grace (minutes)").first(), "selfie": (p) => p.getByLabel(/Require a selfie/).first(), "Save rules": (p) => p.getByRole("button", { name: "Save rules" }).first() },
  },
  {
    article: "handle-technical-issue-reports",
    file: "01-issues",
    alt: "Technical issues: your reports and all reports.",
    role: "hr_admin",
    path: "/attendance?tab=issues",
    ready: (p) => p.getByRole("heading", { name: "Attendance", level: 1 }),
    targets: { "all reports": (p) => p.getByText("All reports").first() },
  },
  {
    article: "check-training-status",
    file: "01-training-status",
    alt: "Training status: who passed, who has not, and who is overdue.",
    role: "hr_admin",
    path: "/training",
    viewport: { width: 1280, height: 1400 },
    ready: (p) => p.getByRole("heading", { name: "Training status", level: 1 }),
    targets: { "automatic": (p) => p.getByText(/Automatic assignment/).first(), "evidence": (p) => p.getByText("Client evidence report").first(), "counts": (p) => p.getByText(/^Everyone: /).first(), "filter": (p) => p.getByRole("button", { name: "Filter" }) },
  },
  {
    article: "edit-training-courses",
    file: "01-course-studio",
    alt: "Course studio: read, compare and edit the courses.",
    role: "hr_admin",
    path: "/course-studio",
    ready: (p) => p.getByRole("heading", { name: "Course studio", level: 1 }),
    targets: { "intro": (p) => p.getByText(/A published version never changes/).first() },
  },
  {
    article: "run-a-review-cycle",
    file: "01-reviews-hr",
    alt: "Reviews: Templates, Launch a cycle and the list of cycles.",
    role: "hr_admin",
    path: "/reviews",
    ready: (p) => p.getByRole("heading", { name: "Reviews", level: 1 }),
    targets: { "Launch a cycle": (p) => p.getByRole("link", { name: "Launch a cycle" }), "Templates": (p) => p.getByRole("link", { name: "Templates" }), "cycles": (p) => p.getByText("Cycles", { exact: true }).first() },
  },
  {
    article: "run-a-review-cycle",
    file: "02-launch",
    alt: "Launch a review cycle: name, type, template, who is reviewed and due dates.",
    role: "hr_admin",
    path: "/reviews/cycles/new",
    viewport: { width: 1280, height: 1300 },
    ready: (p) => p.getByRole("heading", { name: "Launch a review cycle", level: 1 }),
    targets: { "cycle name": (p) => p.getByLabel("Cycle name"), "template": (p) => p.getByLabel("Template"), "who": (p) => p.getByText("Who is reviewed").first(), "launch": (p) => p.getByRole("button", { name: "Launch cycle" }) },
  },
  {
    article: "write-a-team-review",
    file: "01-reviews-lead",
    alt: "Reviews, as a lead: the reviews you write and your team's reviews.",
    role: "team_lead",
    path: "/reviews",
    ready: (p) => p.getByRole("heading", { name: "Reviews", level: 1 }),
    targets: { "goals": (p) => p.getByRole("link", { name: "Goals" }) },
  },
  {
    article: "import-people-from-talenthr",
    file: "01-import",
    alt: "Import from TalentHR: upload, preview, commit, reconcile.",
    role: "hr_admin",
    path: "/settings/import",
    ready: (p) => p.getByRole("heading", { name: "Import from TalentHR", level: 1 }),
    targets: { "upload": (p) => p.getByText("Upload a TalentHR export").first(), "file types": (p) => p.getByText(/CSV or Excel/).first() },
  },
  {
    article: "import-people-from-talenthr",
    file: "02-go-live",
    alt: "The go-live checklist: some rows check themselves, the rest you tick.",
    role: "hr_admin",
    path: "/settings/go-live",
    viewport: { width: 1280, height: 1300 },
    ready: (p) => p.getByRole("heading", { name: "Go-live checklist", level: 1 }),
    targets: { "first rows": (p) => p.getByText("Production settings are in place").first(), "privacy notice": (p) => p.getByText(/The privacy notice is published/).first(), "mark done": (p) => p.getByRole("button", { name: "Mark done" }).first() },
  },
  {
    article: "read-the-audit-log",
    file: "01-audit-log",
    alt: "The audit log: who did what, and when.",
    role: "super_admin",
    path: "/settings/audit-log",
    ready: (p) => p.getByRole("heading", { name: "Audit log", level: 1 }),
    targets: { "filter": (p) => p.getByLabel("Action starts with"), "table": (p) => p.getByRole("table").first() },
  },
  {
    article: "set-people-records-retention",
    file: "01-retention",
    alt: "People records retention: periods, counts and the nightly job.",
    role: "hr_admin",
    path: "/settings/people-retention",
    viewport: { width: 1280, height: 950 },
    ready: (p) => p.getByRole("heading", { name: "People records retention", level: 1 }),
    targets: { "archive months": (p) => p.getByLabel(/until the HR-only archive/), "anonymize months": (p) => p.getByLabel(/until personal data is anonymized/), "would move": (p) => p.getByText("What would move at the next run").first() },
  },

  // Safe Voice is its own site (apps/safe-voice, port 3100 here): start it with the dev server before taking these
  {
    article: "report-something-anonymously",
    file: "01-send-a-report",
    alt: "Safe Voice: say what this is about and what happened. No name is asked.",
    role: "employee",
    anonymous: true,
    path: `${SAFE_VOICE_URL}/`,
    viewport: { width: 1280, height: 1150 },
    ready: (p) => p.getByRole("button", { name: "Send report" }),
    targets: { "about": (p) => p.getByLabel("What is this about?"), "what happened": (p) => p.getByLabel("What happened?"), "attach": (p) => p.getByText("Attach files (optional)").first(), "privacy": (p) => p.getByText("How your privacy is protected").first(), "send": (p) => p.getByRole("button", { name: "Send report" }) },
  },
  {
    article: "report-something-anonymously",
    file: "02-check-a-case",
    alt: "To read a reply, type your case code and passphrase.",
    role: "employee",
    anonymous: true,
    path: `${SAFE_VOICE_URL}/follow-up`,
    ready: (p) => p.getByPlaceholder("SV-XXXX-XXXX-XXXX"),
    targets: { "case code": (p) => p.getByPlaceholder("SV-XXXX-XXXX-XXXX"), "passphrase": (p) => p.getByLabel("Passphrase") },
  },
];
