---
title: Prepare a pay run
summary: For Preparers. Set the rates, add pay lines, start a run for a pay period, fill it in, send it to an Approver, then record the payments.
category: payroll
audience: all
order: 2
updated: 2026-11-05
---

This guide is for people a Super Admin chose as a **Preparer**. If you do not see **Payroll** under **Admin** in the left menu, you have not been chosen, and you cannot open these pages. All names and amounts in this guide and its pictures are made up. For the big picture first, read "How payroll works".

A pay run is prepared by one person and approved by a different person. ELEVATE works out each person's pay for the period. It never works out tax, and it never sends money: you pay in Remitly and record it here.

# Before you start

Open **Payroll** under **Admin** in the left menu. It has four tabs: **Runs**, **Rates**, **Settings** and **History**.

Start with **Settings**. It shows the **Cutoff divisor**, the **Warn at** percentage and the rates for extra hours. Each row is a version with a start date, and the one marked **In force** is the one used today. A run that has extra hours cannot be sent for review while the rate it needs says **Not set**.

![Payroll, Settings: the versions of the pay settings, and the Change settings button.](help:prepare-a-pay-run/01-settings.png)

To change them, click **Change settings**. Choose **Starts on**, check the **Cutoff divisor**, and type each rate as a percent of the normal hourly rate: 125 means 1.25 times. Leave a rate blank until the figure is confirmed. Then click **Save settings**. The old version stays on record.

![The Change pay settings window: the start date, the divisor and the rates.](help:prepare-a-pay-run/02-change-settings.png)

# Add or change a pay line

A pay line says what one person is paid. Someone who works for two clients has two lines.

1. Open the **Rates** tab. It shows one row for each pay line in force.
2. Click **Add pay line**.
3. Choose the **Person**. Fill in **Client** and **Alias** if you need them, **Hours per day**, **FTE** (1 for full time, 0.5 for half), **Monthly rate (pesos)**, **Payment method**, any **Allowance or fee (pesos)** or **Allowance (dollars)**, and **Starts on**.
4. Click **Add pay line**.

![Payroll, Rates: one row for each pay line, with Add pay line.](help:prepare-a-pay-run/03-rates.png)

![The Add a pay line window: the person, the monthly rate and the start date.](help:prepare-a-pay-run/04-add-pay-line.png)

To change a rate, click **Change** on the person's row, fill in the new details and a **Reason for the change**, then click **Save new version**. The old version stays on record. To stop paying a line, click **End**, choose the **Last day**, write a **Reason** and click **End pay line**.

You cannot add or change your own pay line. Another Preparer does it.

# Start a run

1. Open the **Runs** tab and click **New run**.
2. Check **First day** and **Last day**. They are filled in for the last cutoff; change them if you need to.
3. Click **Create run**. ELEVATE opens the run with one line for each pay line in force during the period.

![The Start a pay run window: the first and last day of one cutoff.](help:prepare-a-pay-run/05-new-run.png)

A run always covers one cutoff: the 1st to the 15th, or the 16th to the last day of the month. Any other dates are refused. There is one run for each cutoff. If you chose the wrong period, or the pay lines changed after you made the run, click **Cancel run**, give a **Reason**, and create it again.

# Fill in the run

The new run shows the checks above the worksheet, then one row for each person. Problems that **block** are in red under **Fix these before sending the run for review**. Warnings are in yellow under **Look at these**. They do not stop the run.

![A new run: the checks above the worksheet and one row for each person.](help:prepare-a-pay-run/06-worksheet.png)

- Click **Suggest from approved hours**. ELEVATE suggests absent days, late minutes and extra hours from hours a lead approved. Nothing changes pay until you confirm it.
- Click **Confirm** to accept a suggestion. If a person has more than one pay line, choose the line first (**Assign to line**, or **Assign and confirm**). To use a different amount, enter it yourself and write a reason.
- Click **Amounts** on a person's row to type anything else: extra hours, a loan, another deduction, an allowance, or a reimbursement or bonus. Choose **What to enter**, type the **Amount** and click **Save amount**. Extra hours are whole minutes. A reduction is a loan or an other deduction, never a negative amount. A loan and an other deduction need a **Reason**.

![The Amounts window: what to enter and the amount, here 120 minutes of extra hours.](help:prepare-a-pay-run/07-amounts.png)

- Click the **Dollar rate** button, enter **Pesos for one dollar**, then click **Save rate**. Every run needs it, even when nobody has a dollar allowance: the Remitly list shows each person's pay in dollars.

![The Dollar rate window: how many pesos one dollar is worth for this run.](help:prepare-a-pay-run/08-dollar-rate.png)

- For someone paid for part of the cutoff, enter the days or hours they worked. These can never pay more than a full cutoff; if they do, check what you typed (for example "15" instead of "1.5").
- Click **Mark as checked** on a line when you have read it. It records that a Preparer looked at it. Any change to a line asks for a new check. You must have **another Preparer** check **your own** line if you are paid through payroll yourself, and you cannot send the run until they do.

# Fix a mistake from an earlier run

An approved run never changes. Open **Amounts** on the person's line in a later run and choose **Reimbursement, bonus or adjustment** (they were underpaid) or **Other deduction** (they were overpaid). Choose the earlier run under **Corrects the run of**, and write a **Reason**.

# Send it for review

Fix everything that blocks first: a missing dollar rate, an extra-hours rate not set, pay below zero, days or hours worked that pay more than a full cutoff, a suggestion with no pay line, your own line not checked, a line that cannot be read, or pay lines that changed after the run was made. Warnings (for example days not approved yet) are for you to read.

Click **Send for review** at the bottom of the run. The Approvers are told that a run is waiting. You cannot change the run while it is in review. If it comes back, read the note and fix what it asks.

![The bottom of a run that is ready: Send for review.](help:prepare-a-pay-run/09-ready.png)

# Pay and record

When the run is approved, the **Payment** section appears at the bottom.

1. Click **Download Remitly list**. It has each person's name, alias, pesos and dollars. It never has account numbers. If two people share a name, use the alias to tell them apart.
2. Pay each person in Remitly.
3. Click **Mark paid** on the person's row.

![An approved run: the Payment section with Download Remitly list and a Mark paid button for each person.](help:prepare-a-pay-run/10-payment.png)

Type the **Remitly reference** and check the **Paid on** date, then click **Mark paid**. To fix a mistake, click **Correct** and save the right reference.

![The Mark paid window: the Remitly reference and the date it was paid.](help:prepare-a-pay-run/11-mark-paid.png)

When everyone is marked paid, the run becomes **Paid** and each person is told that their payslip is ready. Another Preparer records your own payment.

![Everyone on the run is paid.](help:prepare-a-pay-run/12-all-paid.png)

# Common mistakes

- **Writing a client's or patient's details in a reason.** Reasons are kept in the change history. Never put client or patient information in them.
- **Sending a run for review with warnings you have not read.** Read each one.
- **Choosing the wrong period.** Cancel and create the run again; do not try to edit it.
- **Expecting to approve your own run.** The person who prepared or changed a run, checked a line on it, or wrote a rate it pays, can never approve it.
- **Forgetting the dollar rate.** It is needed on every run, even one paid only in pesos.

# Try it yourself

- Open the **Rates** tab and read one row.
- Click **New run**, look at the dates, and close the window without saving.
- Open the **History** tab and find the last change you made.
