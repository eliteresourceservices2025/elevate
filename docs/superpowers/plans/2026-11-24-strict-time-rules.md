# Strict time rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiple per-client schedules per VA, a limited break allowance, warn-then-auto-stop clocking, and make-up hours that are not overtime.

**Architecture:** Extend `time.schedules` (client, allotted minutes, same-day overlap), put all new rules in pure files under `src/modules/attendance/` (no DB, no clock), and enforce them in the existing clock transaction in `service.ts`. Auto-stop is a delayed Inngest event queued from the clock transaction (no poller). Make-up hours follow the extra-hours request pattern with their own table.

**Tech Stack:** Next.js 16 server actions, Drizzle (next migration `0172`), Zod, Inngest, Vitest (`pnpm test`, `pnpm test:integration`).

**Spec:** `docs/superpowers/specs/2026-11-24-strict-time-rules-design.md`

## Global Constraints
- All paths relative to `apps/elevate/` unless stated. Read `docs/modules/time-clock.md`, `schedules-and-extra-hours.md`, `hours-review-and-health.md` before each area.
- `time.clock_events` append-only; server clock only; auto-stop appends a `clock_out` with `source = 'auto_stop'` and never edits events.
- No scheduled job more often than every 30 min; auto-stop is a one-off delayed event. A new function goes in BOTH `src/inngest/functions.ts` and `src/modules/health/registry.ts`, wrapped in `track()`.
- Copy: "extra hours", "make-up hours"; never "overtime" or "PTO" outside payroll screens. A shift belongs to the day it starts in the person's own zone.
- Every new action: `requireUser()` then `authorize()`, Zod server-side, `writeAudit()` with `tx`, authz test for all 6 roles, row in `tests/authz/matrix.test.ts`. New tables: RLS on, no public policies.
- People on the Jibble clock (`time.clock_source`) are never auto-stopped and never get break caps; Jibble or Tracker being down never blocks the clock.
- Defaults (spec, owner can change): warning 10 min ahead, company default daily cap 8 h, default break allowance 60 min when no schedule. The daily cap is per person, set by HR.
- Per the owner: run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm build`, then a code review, before every commit; never push.

## Review Focus
- A schedule that crosses midnight or two schedules in different zones on one day (limit must use the shift's own zone).
- Break taken longer than its piece (overbreak) must reduce the remaining allowance, not hide it.
- Clock-out or client switch right at the limit (auto-stop must not double-stop or stop an already-closed session).
- Approved extra hours decided after the stop was queued (the stop must be rescheduled, or ignored when it fires).
- A person with no schedule and no personal cap (uses company default) and a Jibble-clock person (no stop).

---

### Task 1: Migration and schema
**Files:** Modify `src/modules/attendance/schema.ts` (`schedules`, `CLOCK_SOURCES`/source check, new `makeupRequests`), employees cap column in the people schema, attendance rules table; Create `drizzle/0172_*.sql` via `pnpm db:generate`, then hand-edit. Test: `tests/integration/strict-time-schema.test.ts`.

**Interfaces:** Produces `schedules.clientId: uuid | null`, `schedules.allottedMinutesPerDay: smallint | null`; `core.employees.dailyCapMinutes: smallint | null`; rules `defaultDailyCapMinutes` (480), `defaultBreakMinutes` (60), `autoStopWarnMinutes` (10); clock event source value `auto_stop`; table `time.makeup_requests` (see Task 8).

- [ ] Write integration test: two same-employee, same-client schedules with overlapping dates are rejected; same-employee different-client schedules on overlapping dates are accepted; two same-day rows whose time-of-day windows overlap are rejected; `auto_stop` is an accepted event source.
- [ ] Run it; expect FAIL (old exclusion rejects the second client).
- [ ] Edit migration: drop `schedules_no_overlap`; add exclusion on `(employee_id, coalesce(client_id, zero-uuid), daterange)`; add a trigger or check rejecting overlapping time-of-day windows on shared weekdays for one person; add columns and the `auto_stop` source in the source check; RLS on `makeup_requests`.
- [ ] Run `pnpm db:migrate` and the test; expect PASS.
- [ ] Review, then commit `feat(time): schedule clients, allotments and caps schema`.

### Task 2: Pure shift and limit rules
**Files:** Modify `src/modules/attendance/schedule.ts`; Create `src/modules/attendance/day-limits.ts`, `day-limits.test.ts`, extend `schedule.test.ts`.

**Interfaces:**
- `shiftsOn(schedules: readonly ScheduleLite[], personZone: string, date: string): Shift[]` (all shifts starting that day; `ScheduleLite` gains `clientId: string | null`, `allottedMinutesPerDay: number | null`). Keep `shiftOn` as the first of `shiftsOn` so existing callers compile.
- `breakAllowanceLeft(input: { allowanceMinutes: number; breaks: Break[]; nowMs: number }): number` (taken time includes overbreak).
- `stopLimit(input: { nowMs: number; shifts: Shift[]; clientId: string | null; workedMsByClient: Map<string | null, number>; workedMsToday: number; dailyCapMinutes: number | null; companyDefaultCapMinutes: number; approvedWindows: Window[] }): { limitMs: number; reason: "shift_end" | "client_allotment" | "daily_cap" | "approved_extra_end" } | null` (null = no limit).

- [ ] Tests: (a) two shifts 09:00-13:00 A and 14:00-18:00 B yield two shifts, each `scheduledMinutes` minus its break; (b) allowance 60, taken 15 plus a 30 that ran to 40 leaves 5; (c) clientId A allotted 120, worked 100 → limit now+20 min, reason `client_allotment`; (d) no shifts, cap 240 (personal), worked 100 → +140 min; no personal cap uses company default; (e) approved extra window to 20:00 moves the limit to 20:00; (f) midnight-crossing shift limit uses the shift's own end; (g) personal cap beats company default.
- [ ] Run; expect FAIL. Implement the three functions (earliest-limit wins; approved extra window extends only the shift/cap limit, never beyond its end). Run; expect PASS.
- [ ] Review, commit `feat(time): per-client shifts, break allowance and stop limit rules`.

### Task 3: Break allowance enforced
**Files:** Modify `src/modules/attendance/validators.ts:21` (break required on `break_start`), `service.ts` clock transaction, `components/attendance-forms.tsx`/`clock-widget.tsx` (picker), `clock.test.ts`.

**Interfaces:** Consumes `breakAllowanceLeft`, `rulesFor`. Produces refusal strings "Choose 15, 30 or 60 minutes for your break." and "You only have N minutes of break left today."

- [ ] Tests: `break_start` without `breakMinutes` is refused; a 60 piece with 45 left is refused with the N-minutes message; a 15 piece with 45 left succeeds; second break the same day uses the remainder; Jibble-clock person unaffected.
- [ ] Run; expect FAIL. Implement: the schema field becomes required for `break_start`; service computes allowance (schedule break minutes of the person's shift today, else rules default) and rejects over-allowance; UI hides pieces larger than what is left and removes the "no limit" option.
- [ ] Run tests; expect PASS. Review, commit `feat(time): break allowance, no open-ended breaks`.

### Task 4: Multiple schedules for one person
**Files:** Modify `src/modules/attendance/schedule-actions.ts`, `schedule-service.ts`, `validators.ts` (schedule schema gets `clientId`, `allottedMinutesPerDay`), the Schedules page components, `src/modules/schedule-import/*` (rows may carry client and hours; ambiguity still goes to a person), `docs/modules/schedule-import.md`.

**Interfaces:** `loadSchedules` returns `clientId` and `allottedMinutesPerDay`; `setSchedule` adds a row (does not close another client's schedule); closing is per client.

- [ ] Tests: adding a second client schedule keeps the first open; adding a same-client schedule closes the previous the day before (existing behavior); an overlapping same-day window is refused with a clear message; per-role authz unchanged (`attendance.manage_rules`/existing schedule permission).
- [ ] Run; expect FAIL. Implement; show every schedule with client and allotted hours on the person's Schedules view and the lead's team view.
- [ ] Run tests; expect PASS. Review, commit `feat(time): several schedules per person with client and allotted hours`.

### Task 5: Per-person daily cap and flag
**Files:** Modify the Employment tab form and its action in the people/org module (HR only, `org.manage_reporting`), audit; Modify `src/modules/attendance/flag-labels.ts`; Create `queries.ts` helper `peopleWithoutLimit()`.

**Interfaces:** `setDailyCap(employeeId, minutes: number | null)` action (1..960, null clears); flag `no_limit` for people with no schedule and no personal cap.

- [ ] Tests: HR sets 300; Employee/Team Lead denied (authz for 6 roles); audit row carries field name and ids only; `peopleWithoutLimit()` lists a person with neither.
- [ ] Run; expect FAIL; implement; run; expect PASS. Review, commit `feat(time): per-person daily hours cap`.

### Task 6: Auto-stop engine
**Files:** Create `src/modules/attendance/auto-stop.ts` (+ test), `auto-stop-jobs.ts`; Modify `src/inngest/functions.ts` and `src/modules/health/registry.ts`, `service.ts` (queue and cancel), the clock widget and Tracker clock route (`src/app/api/tracker/...`) to return `stopAtMs`/`warnAtMs`.

**Interfaces:** `scheduleAutoStop(tx, employeeId): Promise<void>` computes `stopLimit` and sends Inngest event `attendance/auto-stop.due` with `{ employeeId, sessionStartEventId, limitMs }` delayed to `limitMs` (and a warning event at `limitMs - warn`); `runAutoStop({ employeeId, sessionStartEventId }, nowMs): Promise<"stopped" | "stale" | "excluded">` recomputes the limit, appends `break_end`+`clock_out` (`source='auto_stop'`) only if the same session is still open and the limit has passed; notifies the person and their `timeNoticeUserIds` lead; marks the day with flag `auto_stopped`. Called after every clock transaction that changes the limit (clock_in, break_end, switch_client) and from the extra-hours/make-up approval.

- [ ] Tests (pure + integration): stale event (already clocked out) returns `stale`; event fires early (limit moved by approved extra) returns `stale` and requeues; on break at the limit appends `break_end` then `clock_out`; Jibble-clock person returns `excluded`; two firings stop once; flags and notification created once.
- [ ] Run; expect FAIL. Implement; register function (event-triggered, not cron) in both registries, wrapped in `track()`. The existing 15-minute host backstop also calls `runAutoStop` for any open session past its limit.
- [ ] Show the countdown/warning in the web clock and return `warnAtMs`/`stopAtMs` from the Tracker's clock status response.
- [ ] Run `pnpm test`, `pnpm test:integration`; expect PASS. Review, commit `feat(time): warn then auto-stop the clock at the limit`.

### Task 7: Extra hours interplay
**Files:** Modify `extra-hours-service.ts` (decide/approve calls `scheduleAutoStop`), `extra-hours.ts`, the extra-hours prompt component.

- [ ] Tests: an approved window for client A beyond the shift moves `stopLimit`; with no approved window the limit is the shift end; the extra-hours prompt appears when the limit is within the warning window and offers "ask for extra hours".
- [ ] Run; expect FAIL; implement; run; expect PASS. Review, commit `feat(time): extra hours lift the stop limit only when approved`.

### Task 8: Make-up hours
**Files:** Create `src/modules/attendance/makeup-service.ts`, `makeup-actions.ts`, `makeup-queries.ts`, `makeup.ts` (pure) and tests, UI under `components/`, a page at `/time-off`-adjacent address per the navigation rule (own address, own menu highlight); Modify `permissions.ts`, `tests/authz/matrix.test.ts`, hours review and export readers, `docs/modules/schedules-and-extra-hours.md`.

**Interfaces:** `time.makeup_requests` (`id, employee_id, absence_date, missed_minutes, planned_date, planned_start, planned_end, client_id, status (pending|approved|declined|cancelled), decided_by, decided_at, reason`); actions `requestMakeup`, `decideMakeup`, `cancelMakeup`; permissions `attendance.request_makeup` (own, all roles), `attendance.decide_makeup` (team for Team Lead, all for HR and Super Admin; never the requester's own); pure `makeupCovers(requests, workedWindows): { minutesCovered: number }`.

- [ ] Tests: cannot request for a day with no recorded absence or more than the missed minutes; nobody decides their own; approved window lets the clock run past schedule limits (Task 6 limit input); worked time inside it is tagged `makeup`, never counted as extra; the matching deduction shrinks by minutes covered; export columns show make-up apart from extra.
- [ ] Run; expect FAIL; implement; run; expect PASS. Review, commit `feat(time): make-up hours`.

### Task 9: Docs and final checks
**Files:** Modify `docs/modules/time-clock.md`, `schedules-and-extra-hours.md`, `hours-review-and-health.md`, `docs/RUNBOOK.md`, `docs/modules/help-center.md` guides that show the break picker (re-run `pnpm help:shots` only if a guide shows it).

- [ ] Update docs with the new rules (allowance, auto-stop, caps, make-up, owner decision 2026-11-24).
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`; expect all green, then exercise a clock-in → break → auto-stop path in the built app.
- [ ] Code review the branch; fix findings. Commit `docs(time): strict time rules`. Do not push.

## Self-review
Spec coverage: multiple schedules (1,4), break allowance (2,3), auto-stop and caps (2,5,6), extra hours (7), make-up (8), Jibble exclusion and constraints (6, global). Types match across tasks (`stopLimit`, `scheduleAutoStop`, `breakAllowanceLeft`).
