---
title: Import a Jibble timesheet
summary: For Preparers. Fill a draft pay run from the Jibble timesheet export: client payroll hours, overtime, holiday pay and PTO, then confirm or edit each amount.
category: payroll
audience: all
order: 5
updated: 2026-11-12
---

This guide is for people a Super Admin chose as a **Preparer**. All names and numbers here are made up. You can fill a draft pay run from the timesheet you export from Jibble, so you do not type every person's hours, then edit anything you need.

ELEVATE reads only each person's **totals** from the file. It does not keep clock-in times, breaks, screenshots or locations, and it does not change ELEVATE's own time records. The file's rows are kept encrypted until you fill the run or discard it, and are wiped after 14 days.

# Before you start

- Export the **Custom Timesheets** workbook from Jibble (Excel, one sheet for each person). The sheets must have the **Payroll Hrs** column.
- Add or update the people on the **Rates** tab first, then open the draft run, open **Fill or update this run** and choose **Update people**, so everyone is on the run.

# Steps

1. Open the draft run, open **Fill or update this run** and choose **Import Jibble timesheet**.
2. Choose the Excel file and click **Read the file**. ELEVATE shows the period printed on the sheet. Only days inside the run's period are counted; days outside are listed and ignored.
3. Check the table. Each row is a person from Jibble, with the pay line it matches on this run and what would be filled in. ELEVATE matches by the Jibble member code it remembers from earlier imports, then by name. If it cannot be sure (for example a person paid by two clients has two Jibble members and two pay lines), the row says **Choose a pay line**. Pick the right line or **Skip this person**.
4. Click **Fill the run**. ELEVATE writes **suggested** amounts on each matched line and takes you back to the run.
5. Read the suggestions on the worksheet, change any that are wrong, then click **Confirm all suggestions** (or confirm one at a time). Nothing changes anyone's pay until you confirm.

# What is filled in

- **Client payroll hours:** each person's total **Payroll Hrs**. These are for invoicing the client and never change pay.
- **Overtime (OT), regular day:** Jibble's Daily OT, Double OT and Weekly OT.
- **Overtime (OT), rest day:** Jibble's Rest day OT.
- **Holiday pay:** Jibble's Public holiday OT, paid one to one.
- **PTO days:** Jibble's PTO hours divided by the person's hours per day, as paid days on the statement.

A kind with no hours is left empty. An amount you already **confirmed** is never overwritten if you import again, and an unchanged suggestion is not written twice.

# Common mistakes

- **Importing before the people are on the run.** A Jibble member with no matching line is left for you to match or skip. Use **Update people** first.
- **Two Jibble members for one person.** Choose the right pay line for each once; ELEVATE remembers the choice for the next import.
- **Expecting pay to change at once.** Imported amounts are suggestions until you confirm them.

# Try it yourself

- On a draft run, open **Fill or update this run**, choose **Import Jibble timesheet**, read a file, look at the table, and click **Discard this upload**.
