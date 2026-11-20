---
title: Publish a version of the ELEVATE Tracker App
summary: Write what changed, publish a version, withdraw one, and see which computers are behind.
category: attendance
audience: super_admin, hr_admin
order: 11
updated: 2026-11-20
---

Everyone downloads the **ELEVATE Tracker App** from the **ELEVATE Tracker App** page. You decide which version they see and what the notes say. You never handle the app files: after the app is built and signed, the release script adds them.

# Create a release

1. Click **Settings** in the left menu, then **ELEVATE Tracker**, then **Releases**.
2. Click **New release**.
3. Type the **Version**, three numbers with dots, such as 1.2.0. It must be higher than every earlier version. A version number is never used twice.
4. Write what changed under **Added**, **Improved** and **Fixed**, one change per line, in plain English. At least one line is needed.
5. Tick **Required update** if older versions must update before they can send anything.
6. Tick **Adds new data collection** only if this version records something it did not record before. Then choose the published monitoring policy version that covers it. A release like this cannot be published without one.
7. Click **Create draft**. A message says the draft was created.

# Add the app files

A draft needs its files before it can be published. Ask the person who builds the app to run the release script for this version. Each computer type needs an installer and an update file. The list on the Releases page shows which computer types have files.

# Publish

1. Find the draft in the list and click **Publish**.
2. Confirm. A message says the version is published.

A published release **cannot be edited**. If a note has a mistake, withdraw the release and publish a new version. You cannot publish a draft if a newer release already exists, if it has no installer, or if an installer has no update file.

# Withdraw a release

1. Click **Withdraw** on a published release and confirm.
2. People stop being offered that version, and the previous published version is offered again.

You can delete a draft with **Delete draft**. Its files are removed too.

# See which computers are behind

Open **Activity**, then the **Devices** tab. A computer on an older version shows **Behind**, with the newest version. **Needs attention** includes these computers.
