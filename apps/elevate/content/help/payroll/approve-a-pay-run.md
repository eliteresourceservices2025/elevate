---
title: Approve a pay run
summary: For Approvers. Read a run sent for review, then approve it or send it back with a note.
category: payroll
audience: all
order: 3
updated: 2026-11-05
---

This guide is for people a Super Admin chose as an **Approver**. If you do not see **Payroll** under **Admin** in the left menu, you have not been chosen. All names and amounts in this guide and its pictures are made up. For the big picture first, read "How payroll works".

Your job is to be a second pair of eyes. You see every line, the change from the last run, the totals and the checks. You approve, or you send the run back to the Preparer with a note.

# Who can approve

You cannot approve a run if you:

- created it, sent it for review, entered or checked anything on it, or changed anything on it;
- wrote one of the pay rates it uses;
- have a line on the run that no other Preparer has checked.

ELEVATE refuses this on the server, with no way around it. If it refuses you, ask another Approver.

# Steps

1. Click **Payroll** under **Admin** in the left menu. On the **Runs** tab, open the run whose status is **In review**. The Dashboard also shows how many runs are waiting for you.
2. Read the **checks** above the worksheet. A problem that blocks must be sent back. Warnings are for you to judge.
3. Read the worksheet line by line. Check **Cutoff pay**, **Absences**, **Late and undertime**, the extra hours, the allowances, **Gross** and **Net**, and the **Change from last run**. Use the **Totals** and **By client** to see whether the whole run makes sense.
4. Opening the run is written to the audit log. Amounts are never sent in notices.

![A run in review as the Approver sees it: the status, the checks and the worksheet with every line.](help:approve-a-pay-run/01-in-review.png)

5. Scroll to the bottom. Click **Approve** when you are satisfied. A message says **Run approved.**

![The bottom of the run: Approve and Send back.](help:approve-a-pay-run/02-approve-bar.png)

If anything changes while you are reading, ELEVATE asks you to reload and review again, so you never approve figures you did not see. The approval covers every line of the run, on every page of the worksheet.

# Send a run back

1. Click **Send back**.
2. Under **What needs to change**, write a short note. Do not write client or patient details.
3. Click **Send back**. The Preparers are told. They fix the run and send it again, and you review it again.

![The Send back window: a short note about what needs to change.](help:approve-a-pay-run/03-send-back.png)

If you close this window after typing, ELEVATE asks **Discard what you wrote?** so a long note is not lost by accident.

# After approval

An approved run can no longer change. If a mistake is found later, the Preparer fixes it with an adjustment on a later run.

# Read the history

Open the **History** tab to see every change: who did it, when, the old and new values and the reason. You can filter by **Pay run**, **Person**, **Changed by** and dates, then click **Filter**. Opening a page of the history is written to the audit log.

![Payroll, History, filtered to one run: who changed what and when.](help:approve-a-pay-run/04-history.png)

# Common mistakes

- **Approving after only reading the totals.** Read the lines.
- **Approving quickly because the Preparer is a colleague.** The check only works if you do it.
- **Writing a person's name or details in a send-back note.** Say what needs to change, not who said what.

# Try it yourself

- If there is a run waiting for approval, open it and read one line against its **Net**.
- Open **History** and filter by a run.
