#!/usr/bin/env npx tsx
/**
 * Bulk import schedules and client assignments from the October Timesheet CSV.
 * Run with: pnpm --filter elevate tsx scripts/bulk-import-schedules.ts
 *
 * This script:
 * 1. Parses the attendance sheet CSV
 * 2. Matches/fuzzy-matches names to existing employees, creates new ones if needed
 * 3. Matches/creates clients
 * 4. Parses schedule strings into shift patterns
 * 5. Creates client assignments with start dates
 * 6. Creates schedules for each employee
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CSV_PATH = "C:/Users/lorie/Downloads/Attendance Sheet - October Timesheet.csv";
const DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const COMPANY_TIMEZONE = "America/Phoenix";

const sql = postgres(DATABASE_URL, { prepare: false, max: 5 });

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CsvRow {
  date: string;
  dayOfWeek: string;
  name: string;
  client: string;
  schedule: string;
  in: string;
  lunch: string;
  back: string;
  out: string;
  totalHours: string;
}

interface ParsedSchedule {
  startTime: string;
  endTime: string;
  weekdays: number[];
  timeZone: string;
  breakMinutes: number;
}

interface Employee {
  id: string;
  employee_number: string | null;
  legal_first_name: string;
  legal_middle_name: string | null;
  legal_last_name: string;
  preferred_name: string | null;
  work_email: string;
  status: string;
}

interface Client {
  id: string;
  name: string;
  time_zone: string;
}

// Employee data from CSV - we'll create these
const CSV_EMPLOYEES = new Map<string, {
  firstName: string;
  middleName: string | null;
  lastName: string;
  client: string;
  schedule: string;
}>();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function parseCsv(content: string): CsvRow[] {
  const lines = content.trim().split("\n");
  const rows: CsvRow[] = [];
  let currentDate = "";
  let currentDay = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(",").map(c => c.trim().replace(/^"/, "").replace(/"$/, ""));

    if (cols[0].match(/^\d{2}\/\d{2}\/\d{2}$/)) {
      currentDate = cols[0];
      currentDay = cols[1] || "";
      continue;
    }

    if (cols[1] === "Name" && cols[2] === "Client") continue;

    if (cols.length >= 9 && cols[1]) {
      rows.push({
        date: currentDate,
        dayOfWeek: currentDay,
        name: cols[1],
        client: cols[2],
        schedule: cols[3],
        in: cols[4],
        lunch: cols[5],
        back: cols[6],
        out: cols[7],
        totalHours: cols[8],
      });

      // Collect unique employees from CSV
      if (!CSV_EMPLOYEES.has(cols[1])) {
        const nameParts = cols[1].trim().split(/\s+/);
        let firstName = nameParts[0];
        let middleName = null;
        let lastName = nameParts[nameParts.length - 1];
        if (nameParts.length > 2) {
          middleName = nameParts.slice(1, -1).join(" ");
        }
        CSV_EMPLOYEES.set(cols[1], { firstName, middleName, lastName, client: cols[2], schedule: cols[3] });
      }
    }
  }

  return rows;
}

function parseScheduleString(schedule: string): ParsedSchedule | null {
  if (!schedule || schedule === "Training" || schedule.trim() === "") return null;

  const s = schedule.trim();
  const separator = s.includes(" to ") ? " to " : " - ";
  const parts = s.split(separator);
  if (parts.length !== 2) {
    console.warn(`  Could not parse schedule: "${schedule}"`);
    return null;
  }

  const startStr = parts[0].trim();
  const rest = parts[1].trim();

  const timeZoneMatch = rest.match(/^(.+?)\s+([A-Z]{2,3})(?:\s+([MTWRFSU\-]+))?$/i);
  if (!timeZoneMatch) {
    console.warn(`  Could not parse time/timezone from: "${rest}"`);
    return null;
  }

  const endTimeStr = timeZoneMatch[1].trim();
  const tzAbbr = timeZoneMatch[2].toUpperCase();
  const weekdaysStr = timeZoneMatch[3]?.replace(/\s+/g, "") || "";

  const tzMap: Record<string, string> = {
    "AZ": "America/Phoenix",
    "ET": "America/New_York",
    "CT": "America/Chicago",
    "MT": "America/Denver",
    "PT": "America/Los_Angeles",
  };

  const timeZone = tzMap[tzAbbr] || "America/Phoenix";

  const startTime = parseTime12h(startStr);
  const endTime = parseTime12h(endTimeStr);

  if (!startTime || !endTime) {
    console.warn(`  Could not parse times: "${startStr}" - "${endTimeStr}"`);
    return null;
  }

  let weekdays: number[] = [1, 2, 3, 4, 5];
  if (weekdaysStr) {
    weekdays = parseWeekdays(weekdaysStr);
  }

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  let spanMinutes = endMin - startMin;
  if (spanMinutes < 0) spanMinutes += 24 * 60;
  const breakMinutes = spanMinutes > 8 * 60 ? 60 : (spanMinutes > 6 * 60 ? 30 : 0);

  return { startTime, endTime, weekdays, timeZone, breakMinutes };
}

function parseTime12h(timeStr: string): string | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3].toLowerCase();

  if (period === "pm" && hours !== 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;

  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

function parseWeekdays(str: string): number[] {
  const dayMap: Record<string, number> = { M: 1, T: 2, W: 3, R: 4, F: 5, S: 6, U: 7 };

  const rangeMatch = str.match(/^([MTWRFSU])\-([MTWRFSU])$/i);
  if (rangeMatch) {
    const start = dayMap[rangeMatch[1].toUpperCase()];
    const end = dayMap[rangeMatch[2].toUpperCase()];
    if (start && end && start <= end) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }

  const days: number[] = [];
  for (const ch of str.toUpperCase()) {
    if (dayMap[ch]) days.push(dayMap[ch]);
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function computeHoursPerWeek(schedule: ParsedSchedule): number {
  const startMin = timeToMinutes(schedule.startTime);
  const endMin = timeToMinutes(schedule.endTime);
  let spanMinutes = endMin - startMin;
  if (spanMinutes < 0) spanMinutes += 24 * 60;
  const workMinutes = spanMinutes - schedule.breakMinutes;
  const dailyHours = workMinutes / 60;
  return Math.round(dailyHours * schedule.weekdays.length * 10) / 10;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

function generateEmail(firstName: string, lastName: string, usedEmails: Set<string>): string {
  let email = `${slugify(firstName)}.${slugify(lastName)}@eliteresourceservices.com`;
  let counter = 2;
  while (usedEmails.has(email)) {
    email = `${slugify(firstName)}.${slugify(lastName)}${counter}@eliteresourceservices.com`;
    counter++;
  }
  usedEmails.add(email);
  return email;
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

async function main() {
  console.log("Starting bulk import from attendance sheet...\n");

  // Read and parse CSV
  const content = readFileSync(CSV_PATH, "utf-8");
  const rows = parseCsv(content);
  console.log(`Parsed ${rows.length} rows from CSV`);
  console.log(`Found ${CSV_EMPLOYEES.size} unique employees in CSV`);

  // Get all active employees from DB
  const allEmployees = await sql<Employee[]>`
    SELECT id, employee_number, legal_first_name, legal_middle_name, legal_last_name, preferred_name, work_email, status
    FROM core.employees
    WHERE archived_at IS NULL AND status <> 'separated'
    ORDER BY legal_first_name, legal_last_name
  `;

  console.log(`Found ${allEmployees.length} active employees in database`);

  // Get all active clients
  const allClients = await sql<Client[]>`
    SELECT id, name, time_zone
    FROM core.clients
    WHERE archived_at IS NULL
    ORDER BY name
  `;

  console.log(`Found ${allClients.length} active clients in database`);

  // Track used emails
  const usedEmails = new Set(allEmployees.map(e => e.work_email.toLowerCase()));

  // Create or find employees from CSV
  const csvEmployeeMap = new Map<string, string>(); // csv name -> employee id

  // Find max existing employee number
  const existingNumbers = allEmployees
    .map(e => (e as any).employee_number?.match(/ERS-(\d+)/)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(n => parseInt(n, 10));
  let nextEmployeeNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;

  for (const [csvName, info] of CSV_EMPLOYEES) {
    // Try to find existing employee by name
    let matchedEmp = allEmployees.find(e => {
      const fullName = `${e.legal_first_name} ${e.legal_middle_name || ""} ${e.legal_last_name}`.trim().toLowerCase();
      return fullName === csvName.toLowerCase();
    });

    if (!matchedEmp && info.middleName) {
      matchedEmp = allEmployees.find(e =>
        e.legal_first_name.toLowerCase() === info.firstName.toLowerCase() &&
        e.legal_last_name.toLowerCase() === info.lastName.toLowerCase() &&
        e.legal_middle_name?.toLowerCase() === info.middleName.toLowerCase()
      );
    }

    if (!matchedEmp) {
      matchedEmp = allEmployees.find(e =>
        e.legal_first_name.toLowerCase() === info.firstName.toLowerCase() &&
        e.legal_last_name.toLowerCase() === info.lastName.toLowerCase()
      );
    }

    if (matchedEmp) {
      csvEmployeeMap.set(csvName, matchedEmp.id);
      console.log(`  Matched existing: ${csvName} -> ${matchedEmp.id}`);
    } else {
      // Create new employee
      const email = generateEmail(info.firstName, info.lastName, usedEmails);
      const employeeNumber = `ERS-${String(nextEmployeeNumber).padStart(4, "0")}`;
      nextEmployeeNumber++;

      const [newEmp] = await sql<Employee[]>`
        INSERT INTO core.employees (
          id, employee_number, legal_first_name, legal_middle_name, legal_last_name,
          work_email, personal_email, mobile, country, status, worker_type,
          position, start_date, created_by
        )
        VALUES (
          ${randomUUID()}, ${employeeNumber}, ${info.firstName}, ${info.middleName}, ${info.lastName},
          ${email}, NULL, NULL, 'PH', 'active', 'contractor',
          'Healthcare Virtual Assistant', '2026-10-01', NULL
        )
        RETURNING id, legal_first_name, legal_middle_name, legal_last_name, preferred_name, work_email, status
      `;

      csvEmployeeMap.set(csvName, newEmp.id);
      allEmployees.push(newEmp);
      console.log(`  Created new: ${csvName} (${email}) -> ${newEmp.id}`);
    }
  }

  // Group rows by employee and client to get unique assignments
  const assignments = new Map<string, { employeeId: string; clientId: string; schedule: ParsedSchedule; startDate: string }>();

  for (const row of rows) {
    // Skip rows with 0 hours (not working that day)
    if (!row.schedule || row.schedule === "Training" || parseFloat(row.totalHours) === 0) continue;

    // Get employee ID
    const employeeId = csvEmployeeMap.get(row.name);
    if (!employeeId) {
      console.warn(`  No employee mapping for: "${row.name}"`);
      continue;
    }

    // Match or create client
    let client = allClients.find(c => c.name.toLowerCase() === row.client.toLowerCase());
    if (!client) {
      // Create new client
      const parsedSchedule = parseScheduleString(row.schedule);
      const clientTz = parsedSchedule?.timeZone || "America/Phoenix";

      console.log(`  Creating new client: "${row.client}" (${clientTz})`);
      const [newClient] = await sql<Client[]>`
        INSERT INTO core.clients (name, time_zone, holiday_calendar, handles_phi, is_active)
        VALUES (${row.client}, ${clientTz}, 'US', true, true)
        RETURNING id, name, time_zone
      `;
      client = newClient;
      allClients.push(client);
    }

    // Parse schedule
    const parsedSchedule = parseScheduleString(row.schedule);
    if (!parsedSchedule) {
      console.warn(`  Could not parse schedule for ${row.name} @ ${row.client}: "${row.schedule}"`);
      continue;
    }

    // Use the earliest date for this employee+client combo as start date
    const key = `${employeeId}-${client.id}`;
    const existing = assignments.get(key);
    if (!existing || row.date < existing.startDate) {
      const [mm, dd, yy] = row.date.split("/");
      const startDate = `20${yy}-${mm}-${dd}`;
      assignments.set(key, { employeeId, clientId: client.id, schedule: parsedSchedule, startDate });
    }
  }

  console.log(`\nFound ${assignments.size} unique employee-client assignments to create/update`);

  // Now create/update assignments and schedules
  let createdAssignments = 0;
  let updatedAssignments = 0;
  let createdSchedules = 0;

  for (const [key, assignment] of assignments) {
    const { employeeId, clientId, schedule: sched, startDate } = assignment;

    const emp = allEmployees.find(e => e.id === employeeId);
    const cli = allClients.find(c => c.id === clientId);
    console.log(`\nProcessing: ${emp?.legal_first_name} ${emp?.legal_last_name} -> ${cli?.name} (${startDate})`);

    // Check existing client assignment
    const existingAssignments = await sql`
      SELECT id, start_date, hours_per_week
      FROM core.client_assignments
      WHERE employee_id = ${employeeId} AND client_id = ${clientId}
    `;

    const hoursPerWeek = computeHoursPerWeek(sched);
    console.log(`  Schedule: ${sched.startTime}-${sched.endTime} ${sched.timeZone} on days [${sched.weekdays.join(",")}], break: ${sched.breakMinutes}min, hours/week: ${hoursPerWeek}`);

    if (existingAssignments.length === 0) {
      await sql`
        INSERT INTO core.client_assignments (employee_id, client_id, start_date, end_date, hours_per_week)
        VALUES (${employeeId}, ${clientId}, ${startDate}, NULL, ${hoursPerWeek})
      `;
      console.log(`  ✓ Created client assignment`);
      createdAssignments++;
    } else {
      const existing = existingAssignments[0];
      if (existing.start_date !== startDate || Number(existing.hours_per_week || 0) !== hoursPerWeek) {
        await sql`
          UPDATE core.client_assignments
          SET start_date = ${startDate}, hours_per_week = ${hoursPerWeek}, updated_at = NOW()
          WHERE id = ${existing.id}
        `;
        console.log(`  ✓ Updated client assignment (start: ${existing.start_date} -> ${startDate}, hours: ${existing.hours_per_week} -> ${hoursPerWeek})`);
        updatedAssignments++;
      } else {
        console.log(`  - Assignment already current`);
      }
    }

    // Create schedule
    const existingSchedules = await sql`
      SELECT id, start_time, end_time, weekdays, break_minutes, zone
      FROM time.schedules
      WHERE employee_id = ${employeeId} AND effective_to IS NULL
    `;

    if (existingSchedules.length === 0) {
      await sql`
        INSERT INTO time.schedules (employee_id, effective_from, effective_to, start_time, end_time, weekdays, break_minutes, zone)
        VALUES (${employeeId}, ${startDate}, NULL, ${sched.startTime}, ${sched.endTime}, ${sched.weekdays}, ${sched.breakMinutes}, ${sched.timeZone})
      `;
      console.log(`  ✓ Created schedule`);
      createdSchedules++;
    } else {
      const existing = existingSchedules[0];
      const scheduleChanged =
        existing.start_time !== sched.startTime ||
        existing.end_time !== sched.endTime ||
        JSON.stringify([...existing.weekdays].sort()) !== JSON.stringify(sched.weekdays.sort()) ||
        existing.break_minutes !== sched.breakMinutes ||
        existing.zone !== sched.timeZone;

      if (scheduleChanged) {
        const dayBefore = addDays(startDate, -1);
        await sql`
          UPDATE time.schedules
          SET effective_to = ${dayBefore}
          WHERE id = ${existing.id}
        `;

        await sql`
          INSERT INTO time.schedules (employee_id, effective_from, effective_to, start_time, end_time, weekdays, break_minutes, zone)
          VALUES (${employeeId}, ${startDate}, NULL, ${sched.startTime}, ${sched.endTime}, ${sched.weekdays}, ${sched.breakMinutes}, ${sched.timeZone})
        `;
        console.log(`  ✓ Replaced schedule (old ended ${dayBefore})`);
        createdSchedules++;
      } else {
        console.log(`  - Schedule already current`);
      }
    }
  }

  console.log("\n========== SUMMARY ==========");
  console.log(`Client assignments created: ${createdAssignments}`);
  console.log(`Client assignments updated: ${updatedAssignments}`);
  console.log(`Schedules created: ${createdSchedules}`);
  console.log("Done!");

  await sql.end();
}

main().catch(console.error).finally(() => process.exit(0));