---
title: Set and import schedules
summary: Give people one or more shift schedules, or import many from the attendance sheet.
category: time-off
audience: super_admin, hr_admin, team_lead
order: 3
video: set-and-import-schedules
updated: 2026-11-25
---

A **schedule** is a shift pattern: the days, the start and end times and, if it is for a client, the client. A person can have **several at once**, for example different times on different days, or two clients. The time clock uses them to flag lateness, early leaves, absences and extra hours. A person with no schedule gets no flags.

A shift belongs to the day it **starts** in the person's own time zone.

# Who sees what

- Everyone sees their own schedules.
- A Team Lead sees their team's schedules, read only.
- HR and Super Admin set and change schedules.

# Add a schedule

1. Click **Schedules** in the left menu.
2. Tick the people in the list first, then click **Set schedule for** them. Or click a person's name, then **Add schedule**.
3. Choose what saving does:
   - **Add to their current schedules** keeps what they have.
   - **Replace all their schedules from the start date** ends everything else the day before.
4. Fill in **Starts on** and, if needed, **Time zone**. Leave the zone empty to use each client's time zone.
5. For each shift pattern, fill in **Client**, **Shift starts**, **Shift ends**, **Client hours per day**, **Unpaid break (minutes)** and **Working days**. An end before the start means the shift ends the next day.
6. For another time or client, click **Add another shift pattern**.
7. Save. A message says **Schedule saved**.

Two shifts of one person cannot overlap. If they do, nothing is saved and the message says which one.

Days with no shift are rest days. The person cannot clock in on a rest day unless extra or make-up hours are approved.

![The Schedules page: tick people, then set a schedule.](help:set-and-import-schedules/01-schedules.png)

# See one person's week

Click a person's name. Each day shows every shift in the client's time and in Manila time. Use **Previous week** and **Next week** to look around. Below are the current, upcoming and earlier schedules.

# Change one schedule

On the person's page, each schedule has its own buttons. The others stay as they are.

- **Edit** fixes a mistake. Write **Why is this being corrected?** It is offered for schedules from the last 7 days or that have not started. A message says **Schedule corrected.**
- **Replace** gives new hours from a date. The old ones end the day before. A message says **Schedule replaced.**
- **Remove** stops it after the last day you choose. One that has not started simply does not apply.

# Change one day

Use this when a day is different, for example one client asks for the whole day and another says not to work.

1. On the person's page, click **Change a day** and pick the date. The date is in the client's calendar.
2. Choose **Whole day for** a client, **Day off for all clients**, or **Custom hours**. Custom lets you keep, change or turn off each client's shift, or add one.
3. Check the **Result**, write **Why is this day different?** and click **Save day**. A message says **Day saved. The person was told.**

The clock follows the new hours, so no extra hours request is needed for them. A day with everything off is a rest day. Under **Changed days**, **Undo** brings the usual schedule back.

# Hours per day, for people with no fixed schedule

On the person's page you see their week of hours. Click a day to **Set hours**, mark a **Day off**, or go **Back to usual**. Change **Usual hours per day** if needed, then **Save changes**. **Copy to next week** repeats the week. These days are the person's own.

For several people: tick them, click **Set schedule for** them, choose **Hours per day only (no fixed schedule)**, pick the dates and weekdays, and save. People who have a fixed schedule are skipped and named.

On a **Day off** the person cannot clock in unless extra or make-up hours are approved.

# End every schedule

Tick the people, then click **End schedule for** them. Tick **Also remove schedules that start after that day** if they have upcoming ones.

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

The import never reads worked hours from the sheet. ELEVATE is the only source of hours. It does not change the schedules of someone who has several, or who has client schedules: change those on their own page. You can discard a preview. It is removed after 14 days.

![Import schedules and clients from the attendance sheet.](help:set-and-import-schedules/02-import-schedules.png)

# Common mistakes

- **Choosing Replace all when you meant to add.** Replacing ends their other schedules.
- **Leaving a working day without a shift.** That day is a rest day and clock-in is refused.
- **Trusting hours in the sheet.** They are ignored on purpose.

# Try it yourself

- Open **Schedules** and read your own schedule.
- Add two shift patterns for a test person.
