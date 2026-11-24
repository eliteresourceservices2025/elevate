# Strict time rules: multiple schedules, break allowance, auto-stop, make-up hours

Status: draft for the owner's approval (2026-11-24). Project B of three (A: privacy and proof; C: restricted documents are separate designs).

## Intent and why
Hours must follow what each VA was assigned. Today a VA has one schedule, breaks can be open-ended, extra hours only warn, and a missed day always shows as a shortfall. The owner wants the clock to enforce the assignment (per client), breaks to be a limited allowance, extra hours to need approval before they happen, and a clean way to make up missed time that is not overtime.

## Goals
1. A VA can have two or more concurrent schedules, each with a client and allotted hours, overlapping in time of day on the same day.
2. Break allowance per day comes from the schedule. The VA takes it in 15, 30 or 60 minute pieces; unused allowance can be taken later the same day. No open-ended breaks.
3. The clock warns, then auto-stops, when the scheduled hours, the client's allotted hours, or (with no schedule) a default daily cap are used up. Only an approved extra-hours request lets work go past it.
4. Make-up hours: request first, name the missed day/hours being offset, lead approves; recorded as make-up, never OT; clears the matching deduction.

## Non-goals
Pay or tax computation (payroll module only); changing the Jibble-clock people's clock (they get flags only, never auto-stop); staggering breaks across a team; any change to hours approval, export or Tracker evidence rules.

## Anti-goals
Auto-stop must never lose time already worked, never edit clock events (it appends a `clock_out` with source `auto_stop`), and Jibble or the Tracker being down must never block the clock.

## Constraints (from CLAUDE.md)
- `time.clock_events` stays append-only; the server clock decides every time. Corrections are new rows with a reason and approval.
- No scheduled job more often than every 30 min. Auto-stop uses one-off delayed Inngest events (scheduled at clock-in and break end; cancelled or rescheduled on break start, client switch, approved extra, clock-out), not a poller. A 15-min host-cron backstop already exists for attendance-critical work and may close any missed ones.
- Copy says "extra hours", "make-up hours". No "overtime" or "PTO" outside payroll screens.
- Every new action: `requireUser()`, `authorize()`, Zod, `writeAudit()` in the transaction, per-role authz tests and a matrix row; RLS on new tables; `permissions.ts`, `schedules` job registry and `health/registry.ts` changed together.

## Approaches considered
1. **Extend `time.schedules` (chosen by the owner).** Add `client_id`, `allotted_minutes_per_day` (nullable), keep `break_minutes` as the daily allowance. Replace the `schedules_no_overlap` exclusion (employee + date range) with one on employee + client + date range, and a check that two same-day windows of one person do not overlap in time of day. Smallest migration, keeps history and the schedule import.
2. Header with child blocks. Cleaner, but rewrites history, import and flags.
3. Per-day hours on client assignments only. Cannot express same-day client windows.

## Design
**Schedules.** `scheduleFor`/`shiftOn` become `shiftsOn` returning all shifts of a day. Late, early-leave and extra-minutes rules apply per shift and per client. The Schedules page and the import (docs/modules/schedule-import.md) show and set several rows per person; the import's "never guess" rule stays.

**Breaks.** The break picker offers 15/30/60 only, capped by the allowance still unused today (allowance minus break time taken, including overbreak). `plannedBreakMinutes` becomes required on `break_start` (the DB check already restricts to 15/30/60; the null path closes in the action). Overbreak alerts unchanged. With no schedule, allowance defaults to a company setting (**builder to confirm the value, e.g. 60 min**).

**Auto-stop.** The limit of the moment = the earliest of: end of the current shift, scheduled minutes used up (worked, excluding breaks), the current client's allotment used up, the person's own daily cap if no schedule. **The daily cap is set per person** (a "Hours per day" value HR sets on the Employment tab, any length such as 4, 5, 8 or 10 hours, with `org.manage_reporting`-style HR permission and an audit row). A company default applies only to people HR has not set, and HR gets a flag listing people with neither schedule nor cap, so no one is silently unlimited. Warn 10 minutes ahead (setting) in the web clock and the Tracker app; at the limit append `clock_out`, notify the VA and their time lead, and flag the day. An approved extra-hours request for that day/client moves the limit to the end of the approved window. Switching client moves the limit to that client's. Not applied to people on the Jibble clock.

**Make-up hours.** New table `time.makeup_requests` (employee, absence date and missed minutes it offsets, planned date/window, status, decided by/at, reason). Same people-chain approval as extra hours (nobody approves their own). When approved, the window lets the clock run past schedule limits without an extra-hours request; worked time inside it is tagged `makeup` on the day and counted against the named shortfall, so no deduction and no OT. Hours review and export show make-up and OT as separate columns (export computes nothing new).

## Left to the builder
Migration details and backfill (existing schedules get a null client and null allotment, so they behave as today); exact warning length; where the settings live; test plan (pure rule tests for shifts, allowance and limit; integration for the exclusion constraint and auto-stop idempotency).

## Open items (my calls, please check)
- Warning 10 minutes ahead; company default daily cap 8h (only a fallback, since the cap is set per person); default break allowance 60 min if no schedule.
- Make-up needs the absence to be already recorded on the day it offsets.
