---
title: Make a client invoice
summary: For HR and executives. Set a client's billing rate, make an invoice from a pay run, and download the PDF to send.
category: payroll
audience: hr_admin, executive, super_admin
order: 5
updated: 2026-11-12
---

This guide is for HR Admins, Executives and Super Admins. If you do not see **Invoices** under **Admin** in the left menu, you do not have access. All names and amounts here are made up.

An invoice bills one client for one pay run. It uses the **client payroll hours** of each person who works for that client, times the client's hourly rate in US dollars. It never shows what a person is paid.

# Step 1: set the billing rate

1. Open **Invoices**, then the **Billing rates** tab.
2. Choose **Add rate**.
3. Pick the client, the day the rate starts, and the rate for one hour in US dollars, for example `25.50`.
4. Save.

A change is a new rate with a new start date. Older rates stay in the history. An invoice uses the newest rate that started on or before the day you make it. A client with no rate cannot be invoiced.

# Step 2: make the invoice

1. On the **Invoices** tab, choose **New invoice**.
2. Pick the pay run. The window shows each client that has hours on it.
3. Pick the client. You see the people, the hours, the rate and the total before you save.
4. Choose **Make invoice**. The invoice opens.

People with no client are not invoiced. They are listed in the window as "No client". People with 0 hours are left off.

# A different rate for one person

VA rates can differ. On **Invoices**, **Billing rates**:

- **Add standard rate** sets what the client is billed for one hour. Everyone at that client is billed at it.
- **Add a rate for a person** sets a rate of their own at that client, from a start date. Only people who have a pay line for that client can be chosen.

An invoice bills each person at their own rate if they have one in force, and everyone else at the standard rate. If rates differ, the invoice says **Varies by person** at the top and shows each line's rate. If someone has neither a rate of their own nor a standard rate, the window names them and you can't make the invoice until you add one.

# Change, replace or remove an invoice

An invoice never changes once it is made. Open it and choose **Invoice options**:

- **Make a corrected version** makes the next version (for example **-R2**) from the pay run's current hours and today's rates. The earlier version is marked **Replaced** and the page says which one replaces it.
- **Archive this test invoice** hides a test invoice from the list. You can restore it.
- **Void this invoice** is for a real invoice. Give a reason. It stays on record, is stamped **VOID** on the page and the PDF, leaves the main list and its number is never used again.

The top of the **Invoices** page shows what real, live invoices bill this month, how many are live, and how many are kept out of the list. Use the search box to find an invoice by number or client name. The **Live**, **All** and **Test** buttons choose what the list shows: **Live** hides void, replaced and archived invoices, **All** shows everything, and **Test** shows test invoices. A void or replaced invoice is greyed out with its total crossed through. Click anywhere on a row to open the invoice, or use the download icon to get the PDF. To delete archived test invoices for good, choose **All** or **Test** first. To delete void and replaced invoices for good, choose **All** and then **Delete void and replaced invoices for good**. This removes real invoices too, so download the PDF first if you want a copy. A live invoice is never deleted, and the numbers of deleted invoices are never used again, so the numbering has gaps.

# Invoices from a test run

If the pay run is a test run, you can still make an invoice to practise. It is numbered **TEST** (its own series, so real invoice numbers never skip) and the page and PDF say it is a test. Do not send it to a client. An archived test run can't be invoiced.

# What has to be set before you can invoice

There is no setting to switch on. Three things must be in place:

1. **The pay line has a client.** Set it on the **Rates** tab (the **Client** column). A person with no client is not invoiced.
2. **The line has client payroll hours.** Type them on the draft pay run (**Actions**, then **Amounts**, then **Client payroll hours**), or fill them with the Jibble timesheet import. The pay run shows a note, "Has a client but no client payroll hours", until they are there.
3. **The client has a billing rate.** Add it on **Invoices**, then the **Billing rates** tab.

Hours are typed while the run is a draft. If the run is already in review, the Approver sends it back, you add the hours, and you send it again.

# Draft invoices

You can make an invoice from a pay run that is still a draft. It says **DRAFT** on the page and on the PDF, because the hours can still change. Once the run is final, make a new invoice. It gets the same number with **-R2** added, and the first one stays on record.

# Suggested hours

If some hours were filled from an imported timesheet and nobody has confirmed them yet, the invoice still uses them. It shows a note such as "2 lines use suggested hours that are not confirmed yet." Ask the payroll team to confirm them, then make a new invoice if the numbers change.

# Download and send

Choose **Download PDF** on the invoice. **ELEVATE does not send email**, so you send the PDF to the client yourself.

An invoice never changes after it is made. Changing hours or a rate later does not touch it.
