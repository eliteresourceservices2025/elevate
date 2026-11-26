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
    version: "1.3.0",
    date: "2026-11-25",
    title: "Start early without being cut short",
    highlights: [
      "Clocking in before your shift no longer uses up the client's hours, so the clock does not stop before the shift ends. The early time still counts as worked and can show as extra hours to review.",
      "HR can change which client recorded time belongs to, from Change someone's time.",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-11-25",
    title: "Hours show as soon as you clock out",
    highlights: [
      "Hours review and Team attendance update when people clock in or out, on the web or the Tracker App, instead of the next night.",
      "Someone still working shows as Working now with their time so far, not as something to fix.",
      "Hours review has a Refresh this week button and shows when it was last refreshed.",
      "Long client names no longer print over the times in the daily detail.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-25",
    title: "Change one day, and easier hours per day",
    highlights: [
      "HR can change a single day, for example when one client asks for the whole day and another says not to work. The usual schedules stay.",
      "Contractors with no fixed schedule have a week of hours that HR can edit day by day, including a day off.",
      "Hours can be set for several people over a range of dates, with a check of what will be replaced.",
    ],
  },
  {
    version: "1.1.1",
    date: "2026-11-25",
    title: "Several schedules for one person",
    highlights: [
      "A person can now have several schedules at once: different times on different days, for the same client or different ones.",
      "Each person has a week page showing every shift in the client's time and in Manila time. HR can add, edit, replace or remove one schedule without touching the others.",
      "The Schedules list shows each person's week at a glance.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-11-25",
    title: "Reports you can read and answer",
    highlights: [
      "Make-up hours now work for everyone, including HR, leads, executives and recruiters. If you have no schedule, a weekday counts as your daily hours.",
      "Contractors with no fixed schedule can now have their hours set per day, with different hours for specific days. The clock and the extra hours prompt follow them.",
      "Technical issues, time corrections and Contact support have a new inbox: a list on the left with search and filters, and the report you choose opens on the right.",
      "Screenshots now open right inside ELEVATE, with a full-size viewer, instead of downloading.",
      "You can now message each other on a report or request. Whoever handles it can ask a question without deciding yet, and you get a notice when they write.",
    ],
  },
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
