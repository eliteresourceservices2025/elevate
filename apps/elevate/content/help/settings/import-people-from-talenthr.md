---
title: Bring people over from TalentHR
summary: Upload a TalentHR export, preview it, commit it and sign off the reconciliation, then work through the go-live checklist.
category: settings
audience: super_admin, hr_admin
order: 4
updated: 2026-10-22
---

This moves people from TalentHR into ELEVATE in safe steps: upload, preview, commit and reconcile.

# Read this first

- **Do real imports only in the live system.** Never in a test or development copy. Real exports are never put into test systems.
- Nothing is created until you commit. No emails are sent and nobody gets an account when you commit. Invitations come later, in waves.

# Step 1: Upload the export

1. Click **Settings**, then **Import from TalentHR**.
2. Under **Upload a TalentHR export**, choose the file. It can be a CSV or an Excel file (**CSV or Excel (.xlsx) file, up to 2 MB**). From TalentHR it is under **Settings**, **Import and Export**. Only the first sheet of an Excel file is read.
3. Choose where each **Column in the file** goes, and the format dates are in (**Dates in the file look like**: TalentHR uses Month/Day/Year). Click **Read the file**.

The file is kept encrypted and is removed when you commit or discard it, or after 14 days.

![Import from TalentHR: upload, preview, commit, reconcile.](help:import-people-from-talenthr/01-import.png)

# Step 2: Read the preview

Nothing has changed yet. The preview lists the rows as **new**, **changed**, **unchanged** or with errors and warnings. Fix problems in the file and upload it again, or tick the box above to skip the rows with errors.

People are matched by **work email**, so a second try updates the same people. Workers are imported as independent contractors. A person who already has an ELEVATE account keeps their status and dates.

# Step 3: Commit

Click **Commit**. It creates the people and updates the ones already in ELEVATE, all in one go.

# Undo it

If something is wrong, roll the import back. People it created are **archived, not deleted**, unless they have already signed in or have activity. Changes to people who were already in ELEVATE are not undone.

# Step 4: Reconcile

Open the reconciliation. It compares the file with ELEVATE: total people, current people, people who left, skipped rows and managers it could not set. When the numbers fit, click to sign off. A message says **Signed off.**

# The go-live checklist

Click **Settings**, then **Go-live checklist**. Some rows check themselves from the live system, and the rest you tick yourself with **Mark done**:

- Production settings are in place
- The privacy notice is published
- The monitoring policy is published
- At least two Safe Voice handlers are named
- A TalentHR import is reconciled and signed off
- People have accounts (send invitations in waves)
- Domain and DNS, backups checked, and more

Open the checklist on the live site, not a test copy. Its automatic checks describe the copy you are on.

![The go-live checklist: some rows check themselves, the rest you tick.](help:import-people-from-talenthr/02-go-live.png)

# Common mistakes

- **Importing in a test system.** Use the live system only.
- **Sending all invitations at once.** Send them in waves.
- **Skipping the sign-off.** It is the last item to prove the import matches.

# Try it yourself

- Open **Import from TalentHR** and read the steps. Do not upload a real file here.
- Open the **Go-live checklist** and see which rows check themselves.
