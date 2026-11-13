---
title: Prepare a pay run
summary: For Preparers. Set the rates, add pay lines, start a run for a pay period, fill it in, send it to an Approver, then record the payments.
category: payroll
audience: all
order: 2
updated: 2026-11-12
---

This guide is for people a Super Admin chose as a **Preparer**. If you do not see **Payroll** under **Admin** in the left menu, you have not been chosen, and you cannot open these pages. All names and amounts in this guide and its pictures are made up. For the big picture first, read "How payroll works".

A pay run is prepared by one person and approved by a different person. ELEVATE works out each person's pay for the period, all in pesos. It never works out tax, it keeps no dollar rate, and it never sends money: you pay in Remitly at Remitly's own rate and record it here.

# Before you start

Open **Payroll** under **Admin** in the left menu. It has four tabs: **Runs**, **Rates**, **Settings** and **History**.

Start with **Settings**. It shows the **Cutoff divisor**, the **Warn at** percentage and the overtime (OT) rates. Each row is a version with a start date, and the one marked **In force** is the one used today. Overtime is paid at the person's **own hourly rate** times a percent, so it differs per person because their rates differ. If you leave an overtime box blank, the **standard** percent is used: 125 for a regular day, 130 for a rest day and 169 for a rest day past 8 hours, so overtime pays from your first run. Holiday pay is not a setting: it is always one to one (100% of the hourly rate).

![Payroll, Settings: the versions of the pay settings, and the Change settings button.](help:prepare-a-pay-run/01-settings.png)

To change them, click **Change settings**. Choose **Starts on**, check the **Cutoff divisor**, and type each overtime rate as a percent of the normal hourly rate: 125 means 1.25 times. Leave a rate blank until the figure is confirmed. Then click **Save settings**. The old version stays on record.

![The Change pay settings window: the start date, the divisor and the overtime (OT) rates.](help:prepare-a-pay-run/02-change-settings.png)

# Add or change a pay line

A pay line says what one person is paid. Someone who works for two clients has two lines.

1. Open the **Rates** tab. It shows one row for each pay line in force.
2. Click **Add pay line**.
3. Choose the **Person**. Fill in **Client** and **Alias** if you need them, **Hours per day**, **Monthly rate (pesos)**, **Payment method** and **Starts on**. Allowances are not set here: you add them by name on each run.
4. Click **Add pay line**.

![Payroll, Rates: one row for each pay line, with Add pay line.](help:prepare-a-pay-run/03-rates.png)

![The Add a pay line window: the person, the monthly rate and the start date.](help:prepare-a-pay-run/04-add-pay-line.png)

To change a rate, click **Change** on the person's row, fill in the new details and a **Reason for the change**, then click **Save new version**. The old version stays on record. To stop paying a line, click **End**, choose the **Last day**, write a **Reason** and click **End pay line**.

If you are paid through payroll yourself, you can add and change your own pay line and enter amounts on your own line. The change history records it, **another Preparer must check your line**, and a different person records your payment.

# Start a run

1. Open the **Runs** tab and click **New run**.
2. Check **First day** and **Last day**. They are filled in for the last cutoff; change them if you need to.
3. Click **Create run**. ELEVATE opens the run with one line for each pay line in force during the period.

![The Start a pay run window: the first and last day of one cutoff.](help:prepare-a-pay-run/05-new-run.png)

A run always covers one cutoff: the 1st to the 15th, or the 16th to the last day of the month. Any other dates are refused. There is one run for each cutoff. If you chose the wrong period, or the pay lines changed after you made the run, click **Cancel run**, give a **Reason**, and create it again.

# Fill in the run

The new run shows notes above the worksheet, then one row for each person. Nothing in the notes stops you from sending the run: they are there to be read, and the Approver decides. Only a line that **cannot be read** has to be fixed first. Notes in yellow are under **Look at these**.

![A new run: the checks above the worksheet and one row for each person.](help:prepare-a-pay-run/06-worksheet.png)

- **Forgot to add or remove a person?** Add the pay line on the **Rates** tab, then open the run and choose **Fill or update this run**, then **Update people**. It adds the people who now have a pay line in force, moves a line to a newer rate, and takes off a line that is no longer in force, without making another run. To take one person off yourself, open **Actions** on their row, choose **Remove from this run** and give a reason: their line and amounts stay on record but are ignored, and you can put them back from **Taken off this run** under the notes.
- **Fill the run from a Jibble timesheet.** Open **Fill or update this run** and choose **Import Jibble timesheet**; see "Import a Jibble timesheet".
- Click **Confirm all suggestions** to confirm every suggested amount on the run in one step, after you have read them. Each changed line then needs a new check.
- Open **Fill or update this run** and choose **Suggest from approved hours**. ELEVATE suggests absent days, late minutes, overtime (OT) and holiday pay from hours a lead approved. Hours worked on a holiday are suggested as holiday pay. Nothing changes pay until you confirm it.
- Click **Confirm** to accept a suggestion. If a person has more than one pay line, choose the line first (**Assign to line**, or **Assign and confirm**). To use a different amount, enter it yourself and write a reason.
- Open **Actions** on a person's row and choose **Amounts** to type anything else. Choose **What to enter**, type the **Amount** and click **Save amount**:
  - **Time:** absent days, late minutes, overtime (OT) minutes, holiday pay minutes, and days of **Sick leave (SL), unpaid** (taken off like an absence). **Bereavement days, paid** and **PTO days, paid** are written on the statement and take nothing off. ELEVATE does not suggest these three, because Time off does not hold them: you type the days.
  - **Money added:** **Allowance**, **Reimbursement**, **Bonus** and **Adjustment**. Each of these asks for a **Name**, and you can add as many as you need, one at a time (for example Health allowance and Internet allowance). The name is printed on the person's statement.
  - **Money taken off:** a **Loan** and **Other deduction**, each with a **Reason**. A reduction is never a negative amount.
  - Overtime and holiday pay can be typed as **hours or minutes**: choose hours or minutes beside the box and type 1.5 for an hour and a half, or type `1.5 h`, `90 m` or `1:30`. To remove a named line, click **Remove** beside it in the same window.

![The Amounts window: what to enter and the amount, here 120 minutes of overtime.](help:prepare-a-pay-run/07-amounts.png)

![The Amounts window for an allowance: give it a name, like Health allowance, and an amount.](help:prepare-a-pay-run/08-named-allowance.png)

- For someone paid for part of the cutoff, enter the days or hours they worked. These can never pay more than a full cutoff; if they do, check what you typed (for example "15" instead of "1.5").
- Open **Actions** on a line and choose **Mark as checked** when you have read it. It records that a Preparer looked at it. Any change to a line asks for a new check. If you are paid through payroll yourself, **another Preparer** must check **your own** line, and you cannot send the run until they do. Changing your line clears that check.

# Practice runs (test runs)

While you are still practising, mark a run as a **test run** so you can repeat the same pay cycle and tidy up afterwards.

- **Start one:** in **New run**, tick **This is a test run**. A test run can repeat a period that already has a run.
- **Mark one you already made:** open the run, choose **Run options**, then **Mark as a test run**, and give a short reason. This works until the run is marked paid.
- **Repeat a cycle you already approved:** mark the old run as a test run, then choose **Archive this test run**. Its period is free, so you can create the real run again.
- **Archive:** only a test run can be archived, in any status. It leaves the list, is never deleted, and you can bring it back from **Archived test runs** (open it, then **Run options**, **Restore this run**). A real run can never be archived.
- **Nobody sees a statement from a test run.** The people on it are not told, and it never shows under **My pay**. An invoice made from a test run is numbered TEST and stamped TEST, and must not be sent.

A test run can also cover any dates, up to 31 days (a part of a cutoff, or the dates of a Jibble file), while a real run is always one whole cutoff. To rehearse a whole pay cycle, see "Rehearse a pay cycle with a test run".

A Preparer or an Approver can do this. Every step is written to the change history with its reason.

# Fix a mistake from an earlier run

An approved run never changes. Open **Actions** on the person's line in a later run, choose **Amounts**, and choose **Adjustment** (they were underpaid) or **Other deduction** (they were overpaid). Choose the earlier run under **Corrects the run of**, and write a **Reason**.

# Send it for review

Read the notes first (an unassigned suggestion, pay below zero, days or hours worked that pay more than a full cutoff, your own line not checked, pay lines that changed after the run was made, days not approved yet). Only a line that cannot be read stops the run; everything else you can send as it is.

Click **Send for review** at the bottom of the run. The Approvers are told that a run is waiting. You cannot change the run while it is in review. If it comes back, read the note and fix what it asks.

![The bottom of a run that is ready: Send for review.](help:prepare-a-pay-run/09-ready.png)

# Pay and record

When the run is approved, the **Payment** section appears at the bottom.

1. Click **Download Remitly list**. It has each person's name, alias and **Total payable compensation** in pesos, and their **Bank**, **Account name** and **Account number**, so you can pay them without looking anything up. There are no dollar amounts: pay at the rate Remitly shows. If two people share a name, use the alias to tell them apart. Someone with no bank details on file has blank cells, and the page tells you how many. The file holds real account numbers: keep it private and delete it once you have paid. Every download is recorded. On a test run the file shows masked details and says TEST on every row. A Preparer or an Approver can download the list and record the payments.
2. Pay each person in Remitly.
3. Click **Mark paid** on the person's row.

![An approved run: the Payment section with Download Remitly list and a Mark paid button for each person.](help:prepare-a-pay-run/10-payment.png)

Type the **Remitly reference** and check the **Paid on** date, then click **Mark paid**. To fix a mistake, click **Correct** and save the right reference.

![The Mark paid window: the Remitly reference and the date it was paid.](help:prepare-a-pay-run/11-mark-paid.png)

When everyone is marked paid, the run becomes **Paid**. The contractors' statements are not sent by paying: a Preparer or an Approver releases them from **Statements** (see "Release the contractor payment statements"). Someone else records your own payment.

![Everyone on the run is paid.](help:prepare-a-pay-run/12-all-paid.png)

# Common mistakes

- **Writing a client's or patient's details in a reason.** Reasons are kept in the change history. Never put client or patient information in them.
- **Sending a run for review with warnings you have not read.** Read each one.
- **Choosing the wrong period.** Cancel and create the run again; do not try to edit it.
- **Expecting to approve your own run.** The person who prepared or changed a run, checked a line on it, or wrote a rate it pays, can never approve it.
- **Looking for a dollar rate or dollar allowance.** There are none. Type every amount in pesos.

# Try it yourself

- Open the **Rates** tab and read one row.
- Click **New run**, look at the dates, and close the window without saving.
- Open the **History** tab and find the last change you made.
