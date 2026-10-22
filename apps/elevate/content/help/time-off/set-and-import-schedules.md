---
title: Set and import schedules
summary: Give people shift schedules one by one, or import many from the attendance sheet.
category: time-off
audience: super_admin, hr_admin, team_lead
order: 3
video: set-and-import-schedules
updated: 2026-10-21
---

A **schedule** is a person's shift pattern. The time clock uses it to flag lateness, early leaves, absences and extra hours. A person with no schedule gets no flags.

A shift belongs to the day it **starts** in the person's own time zone.

# Who sees what

- Everyone sees their own schedule.
- A Team Lead sees their team's schedules, read only.
- HR and Super Admin set and change schedules.

# Set a schedule

1. Click **Schedules** in the left menu.
2. Tick the people in the list first.
3. Open **Set a schedule**.
4. Fill in:
   - **Shift starts** and **Shift ends**. An end before the start means the shift ends the next day.
   - **Working days.** The other days are rest days.
   - **Unpaid break (minutes)**
   - **Starts on**
   - **Time zone.** Leave it empty to use each person's client zone.
5. Save. A schedule the person already has ends the day before.

Times show in the schedule's zone and also in Manila time (**In Manila**).

![The Schedules page: tick people, then set a schedule.](help:set-and-import-schedules/01-schedules.png)

# Fix a recent mistake

Use **Correct** on a schedule and write **Why is this being corrected?** It changes entries from the last 7 days on. A message says **Schedule corrected.** Older schedules are never rewritten: set a new one from a date instead. A person on two clients in one day needs one shift, from the earliest start to the latest end.

# End a schedule

Use the end action. A message says **Schedule ended.**

# Import many at once from the attendance sheet

HR and Super Admin can import the team's attendance sheet.

1. Click **Settings**, then **Import schedules and clients**.
2. Upload the sheet: **CSV or Excel (.xlsx) file, up to 2 MB**. Do not include client or patient information.
3. Read the preview. It compares the sheet with what ELEVATE holds, and sorts people into:
   - **Would change**
   - **Already matches**
   - **Needs a person**, with the reason. Choose the right record. ELEVATE remembers your choice next time.
   - **On a client but not on the sheet**, who may have left. Nobody is ended automatically.
4. Check the **Break (assumed)** and **Hours per week (estimate)** on each row you apply.
5. Tick the rows to apply, then click **Apply**. A message says **Applied.**

Changes more than 7 days back are **Backdated changes**. You must read the impact and tick **I have reviewed this and want to apply the backdated changes.**

The import never reads worked hours from the sheet. ELEVATE is the only source of hours. You can discard a preview. It is removed after 14 days.

![Import schedules and clients from the attendance sheet.](help:set-and-import-schedules/02-import-schedules.png)

# Common mistakes

- **Setting a schedule from the wrong date.** The old one ends the day before.
- **Trusting hours in the sheet.** They are ignored on purpose.

# Try it yourself

- Open **Schedules** and read your own schedule.
- Set a schedule for a test person.
