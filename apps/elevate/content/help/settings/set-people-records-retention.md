---
title: Set how long people records are kept
summary: Choose when old records move to an HR-only archive and when personal data is anonymized, and put a legal hold on someone.
category: settings
audience: super_admin, hr_admin
order: 6
updated: 2026-10-22
---

After a person's engagement ends, their record is kept in full, then moved to an archive only HR can open, then anonymized. The job that does this is **off until you switch it on**, and counsel must approve the periods first.

# Open it

Click **Settings**, then **People records retention**.

![People records retention: periods, counts and the nightly job.](help:set-people-records-retention/01-retention.png)

# Choose the periods

- **Months after the end date until the HR-only archive.**
- **Months after the end date until personal data is anonymized.**

Click **Save**. A message confirms it. Do not change these without counsel's approval.

# See what would happen

The section **What would move at the next run** shows counts only: how many records would go **To the HR-only archive**, how many **To be anonymized**, and how many are **On legal hold (skipped)**. While the job is off, nothing moves.

# Run the job

When counsel has approved and you are ready, switch on **Run the nightly retention job**. It then runs each night.

# Put a legal hold on someone

If a person's record must not be touched, for example because of a legal matter, put a **legal hold** on their profile. The job skips them. Take it off when the matter ends.

# Applicants have their own setting

Applicant data has a separate setting on the **Recruiting** page. See "Post a job opening and edit the careers page".

# Common mistakes

- **Switching it on before counsel approves the periods.**
- **Forgetting a legal hold.** The record would be archived or anonymized.

# Try it yourself

- Open **People records retention** and read the counts.
