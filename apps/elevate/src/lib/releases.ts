// The releases of ELEVATE, newest first. The first entry is the version the app shows (sidebar, What's new page) and must equal the
// version in package.json (a test checks it). Plain English, written for the people who use ELEVATE; no names, no client details.
//
// Versions: 0.x.y while people were still being invited; 1.0.0 was cut on 2026-11-24 (the owner's call). From here on a minor version
// (1.1.0) is a new feature and a patch (1.0.1) is a fix. Change the first entry's version and package.json together.
// `announcementId`: once the release is announced (with its video), paste that announcement's id here so What's new can link to it.

export type Release = {
  version: string;
  /** yyyy-mm-dd, in the company time zone. */
  date: string;
  title: string;
  highlights: string[];
  announcementId?: string;
};

export const RELEASES: Release[] = [
  {
    version: "1.0.0",
    date: "2026-11-24",
    title: "ELEVATE 1.0",
    highlights: [
      "Breaks are now 15, 30 or 60 minutes taken from your daily break time, and what you do not use you can take later in the day. There are no open-ended breaks any more.",
      "Your clock warns you 10 minutes before your hours run out and then stops by itself. To keep working, ask for extra hours first. If you do not have a schedule, HR sets how many hours you may work in a day.",
      "Working for more than one client? Each client can have its own schedule and hours a day, and the clock follows them.",
      "Make-up hours: if you missed hours, ask your lead before you work them at another time. Approved make-up time counts as regular hours, not extra hours.",
      "Time off now needs a screenshot of your client's approval with every request. Never include client or patient information in it.",
      "Contractors and VAs now see only their own line on the org chart (the people above them, up to the top, and themselves), and the People list is for leads and staff.",
      "HR can share a company file, such as the handbook, with only some teams, clients, roles or people.",
      "Also in this release since 0.2: Messages with calls, the ELEVATE Tracker App for Windows and Mac, contractor payment statements, and client projects on the clock.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-24",
    title: "Announcement videos and What's new",
    highlights: [
      "Announcements can now carry a video (MP4 or WebM, up to 100 MB), played at the top of the announcement and in the sign-in pop-up.",
      "A new What's new page lists every release, and the version of ELEVATE now shows at the bottom of the menu.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-09",
    title: "The first ELEVATE",
    highlights: [
      "People, documents, announcements and policies, time off, the time clock, schedules and extra hours, hours review.",
      "Recruiting, signing, offers and onboarding, reviews and goals, assets, people analytics, Safe Voice.",
      "ELEVATE Learn with HIPAA and Cybersecurity training, the Help center, and Contact support.",
    ],
  },
];

export const APP_VERSION = RELEASES[0].version;
