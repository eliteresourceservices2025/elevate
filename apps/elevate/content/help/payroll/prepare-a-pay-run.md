---
title: Prepare a pay run
summary: For Preparers. Add pay lines, start a run for a pay period, check it and send it to an Approver, then record the payments.
category: payroll
audience: all
order: 1
updated: 2026-11-05
---

This guide is for people a Super Admin chose as a **Preparer**. If you do not see **Payroll** in the left menu, you have not been chosen, and you cannot open these pages. All names and amounts in this guide are made up.

A pay run is prepared by one person and approved by a different person. ELEVATE works out each person's pay for the period. It never works out tax, and it never sends money: you pay in Remitly and record it here.

# Before you start

- Open **Payroll** in the left menu. It has four tabs: **Runs**, **Rates**, **Settings** and **History**.
- On **Settings**, check that the **Cutoff divisor** and the extra-hours rates are filled in. A run that has extra hours cannot be sent for review while a rate is not set.
- On **Rates**, check that every person to be paid has a pay line.

# Add or change a pay line

1. Open the **Rates** tab.
2. Click **Add pay line**.
3. Choose the person under **Choose a person**, then fill in **Client** (optional), **Alias** (optional), **Hours per day**, **FTE**, **Monthly rate (pesos)**, **Payment method**, any allowance, and **Starts on**.
4. Click **Add pay line**.

To change a rate, click **Change** on the person's row, fill in the new details and a **Reason for the change**, then click **Save new version**. The old version stays on record. To stop paying a line, click **End**, choose the **Last day**, write a **Reason** and click **End pay line**.

You cannot add or change your own pay line. Another Preparer does it.

# Start a run

1. Open the **Runs** tab and click **New run**.
2. Check **First day** and **Last day**. They are filled in for the last cutoff; change them if you need to.
3. Click **Create run**. ELEVATE opens the run with one line for each pay line in force during the period.

A run always covers one cutoff: the 1st to the 15th, or the 16th to the last day of the month. Any other dates are refused. There is one run per cutoff. If you chose the wrong period, or the pay lines changed after you made the run, click **Cancel run**, give a **Reason**, and create it again.

# Fill in the run

- Click **Suggest from approved hours**. ELEVATE suggests absent days, late minutes and extra hours from hours a lead approved. Nothing changes pay until you confirm it.
- Click **Confirm** to accept a suggestion. If a person has more than one pay line, choose the line first (**Assign to line**, or **Assign and confirm**). To use a different amount, enter it yourself and write a reason.
- Click **Amounts** on a person's row to type anything else: a loan, another deduction, an allowance, or a reimbursement or bonus. Choose **What to enter**, type the **Amount** and click **Save amount**. A reduction is a loan or an other deduction, never a negative amount. A loan and an other deduction need a **Reason**.
- Click the **Dollar rate** button, enter **Pesos for one dollar**, then click **Save rate**. Every run needs it, even when nobody has a dollar allowance: the Remitly list shows each person's pay in dollars.
- For someone paid for part of the cutoff, enter the days or hours they worked. These can never pay more than a full cutoff; if they do, check what you typed (for example "15" instead of "1.5").
- Every line must be checked by a Preparer. Click **Mark as checked** on a line that is not yours. Your own line is checked by another Preparer, and any change to a line asks for a new check.

# Fix a mistake from an earlier run

An approved run never changes. Open **Amounts** on the person's line in a later run and choose **Reimbursement, bonus or adjustment** (they were underpaid) or **Other deduction** (they were overpaid). Choose the earlier run under **Corrects the run of**, and write a **Reason**.

# Send it for review

The checks appear above the worksheet. Problems that **block** must be fixed first: a missing dollar rate, an extra-hours rate not set, pay below zero, days or hours worked that pay more than a full cutoff, a suggestion with no pay line, your own line not checked, a line that cannot be read, or pay lines that changed after the run was made. Warnings (for example days not approved yet) are for you to read; they do not stop you.

Click **Send for review**. The Approvers are told that a run is waiting. You cannot change the run while it is in review. If it comes back, read the note and fix what it asks.

# Pay and record

When the run is approved:

1. Click **Download Remitly list**. It has each person's name, alias, pesos and dollars. It never has account numbers. If two people share a name, use the alias to tell them apart.
2. Pay each person in Remitly.
3. On the run, click **Mark paid** on the person's row, type the **Remitly reference** and the **Paid on** date, and click **Mark paid**. To fix a mistake, click **Correct** and save the right reference.

When everyone is marked paid, the run becomes **Paid** and each person is told that their payslip is ready. Another Preparer records your own payment.

# Common mistakes

- **Writing a client's or patient's details in a reason.** Reasons are kept in the change history. Never put client or patient information in them.
- **Sending a run for review with warnings you have not read.** Read each one.
- **Choosing the wrong period.** Cancel and create the run again; do not try to edit it.
- **Expecting to approve your own run.** The person who prepared or changed a run, or wrote a rate it pays, can never approve it.

# Try it yourself

- Open the **Rates** tab and read one row.
- Click **New run**, look at the dates, and close the window without saving.
- Open the **History** tab and find the last change you made.
