---
title: Read the audit log
summary: See who did what in ELEVATE, and when. Only a Super Admin can open it.
category: settings
audience: super_admin
order: 5
updated: 2026-10-22
---

The audit log records important things people do in ELEVATE. It cannot be edited or deleted.

# Open it

Click **Settings**, then **Audit log**. The page says how many entries there are, and times are shown in Phoenix and Manila time.

![The audit log: who did what, and when.](help:read-the-audit-log/01-audit-log.png)

# What is recorded

- Sign-ins and authenticator setup
- Role changes and invitations
- Approvals and decisions
- Exports and imports
- Views of private fields, such as government IDs
- Creates, changes and archives of people records, with before and after values (never secrets)

Entries never hold the text of private things, such as a report, a message or a review.

# Read a row

Each row shows **When**, **Who**, **Action**, **Target** and **Details**. The action is a short code, such as `auth.login`. The details show what changed.

# Find something

Use **Action starts with** and click **Filter**. For example, type `sensitive` to see views of private fields, or `auth` for sign-ins.

# Good to know

- It is write-once at the database level. Nobody can change it, not even a Super Admin.
- Test entries from a development copy stay until the database is reset.
- A person can see the activity on their own record on **My data**. Other people are not named there.

# Common mistakes

- **Looking for the text of a report.** It is never in the log, by design.
- **Expecting a deleted entry to disappear.** Nothing is deleted.

# Try it yourself

- Open the **Audit log** and filter by `auth`.
