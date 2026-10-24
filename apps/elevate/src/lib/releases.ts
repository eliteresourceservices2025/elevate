// The releases of ELEVATE, newest first. The first entry is the version the app shows (sidebar, What's new page) and must equal the
// version in package.json (a test checks it). Plain English, written for the people who use ELEVATE; no names, no client details.
//
// Versions: 0.x.y while people are still being invited; 1.0.0 is cut when the owner says every VA has been invited
// (change the first entry's version and package.json together). Minor = a new feature, patch = a fix.
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
