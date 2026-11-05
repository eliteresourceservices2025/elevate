---
title: How payroll works
summary: Start here. Who does what in payroll, how a pay run goes from draft to paid, and where you find your own payslip.
category: payroll
audience: all
order: 1
updated: 2026-11-05
---

This guide explains payroll in ELEVATE in plain words. It is for everyone: the people who prepare and approve pay, and the people who are paid. All names and amounts in this guide and its pictures are made up.

ELEVATE works out each person's pay for a pay period from their pay line (their monthly rate), the hours that leads approved, and anything the Preparer adds, such as a loan or an allowance. It then keeps a permanent record of every change. It does **not** work out tax, and it does **not** send money. Payment is made in Remitly, outside ELEVATE, and then recorded here.

# Who does what

Payroll is not given by job title. Not even a Super Admin can see pay just because of their role. A **Super Admin chooses the people** who can use payroll, and gives each one a level:

- **Preparer.** Sets the rates, makes the pay run for each period, fills it in, sends it for review, downloads the Remitly list and records the payments.
- **Approver.** Reads a run that was sent for review and approves it or sends it back.
- **Viewer.** Can read runs, rates and the history. Cannot change anything.

Everyone else sees only **My pay**, which holds their own payslips.

![Settings, Payroll access: a Super Admin picks a level for one person.](help:how-payroll-works/02-choose-who-has-access.png)

# One person prepares, a different person approves

This is the most important rule. The person who prepared a run, changed it, checked a line on it, or wrote one of the pay rates it uses can **never** approve it. ELEVATE refuses on the server, so there is no way around it. Your own pay line is also checked by another Preparer. This is why a company needs at least two Preparers and two Approvers.

# The life of a pay run

A pay run covers one cutoff: the 1st to the 15th of a month, or the 16th to the last day. There is one run for each cutoff.

1. **Draft.** The Preparer makes the run. ELEVATE adds a line for every person with a pay line in force during the period. The Preparer adds anything that changes pay, sets the dollar rate and checks the lines. A Preparer's own line must be checked by another Preparer.
2. **In review.** The Preparer sends the run to the Approvers. Nobody can change it now.
3. **Approved.** An Approver reads every line and approves. The run is now fixed for good. If it was wrong, it goes back to the Preparer instead.
4. **Paid.** The Preparer downloads the Remitly list, pays each person in Remitly and records each payment. When the last person is recorded, the run becomes Paid and each person is told that their payslip is ready.

A draft that was made for the wrong period, or that is out of date, can be **cancelled**. A cancelled run stays on record but can never be changed or paid.

# Where to find things

- **Payroll** is under **Admin** in the left menu, for people who were chosen. It has four tabs: **Runs**, **Rates**, **Settings** and **History**.
- **My pay** is under **Core HR**, for everyone.

![The left menu with Payroll highlighted, and the Runs tab with each run's period and status.](help:how-payroll-works/01-menu.png)

If you cannot see **Payroll**, you have not been chosen. Ask a Super Admin if you should be.

# What is kept

Every change is written to the change history: who made it, when, the old and new values and the reason. It cannot be edited or removed. Amounts are never sent in notices or emails, and pay is kept encrypted. A person's payslip can be opened only by that person.

# Which guide to read next

- If you prepare pay: "Prepare a pay run".
- If you approve pay: "Approve a pay run".
- If you want to see your own pay: "Read your payslip".

# Common questions

- **I am HR or a Super Admin and I cannot see Payroll.** That is on purpose. Ask a Super Admin to give you a level.
- **Why can't I approve this run?** You prepared it, changed it, checked a line on it, or wrote a rate it uses. Another Approver must do it.
- **Where is my payslip?** Open **My pay**. It appears only after the whole pay run it belongs to is paid.

# Try it yourself

- Open **My pay** and read the page, even if it is empty.
- If you were chosen for payroll, open **Payroll** and look at the four tabs.
