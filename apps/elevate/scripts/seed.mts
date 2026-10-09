// Seeds FAKE data for development: one sign-in account per role, 6 clients and 40 people
// (with encrypted fake IDs). Run: pnpm db:seed
// Refuses to run against production or any unknown remote database. Safe to run repeatedly.
//
// Teams and reporting lines are added in Phase 1.2 (the dataset already knows each person's team).
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { createFieldCrypto } from "@/lib/crypto-core";
import { buildSeedDataset, type SeedDataset } from "@/lib/seed/data";
import { assertSeedAllowed } from "@/lib/seed/guard";
import { SENSITIVE_FIELDS, type SensitiveField } from "@/modules/people/constants";
import { maskFor, sensitiveContext } from "@/modules/people/sensitive";

config({ path: ".env.local" });
assertSeedAllowed(process.env);

const ROLES = ["super_admin", "hr_admin", "team_lead", "recruiter", "executive", "employee"] as const;
const CREDENTIALS_FILE = ".seed-credentials.local"; // git-ignored

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false, onnotice: () => {} });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Reuse the same fake password on re-runs so the saved file stays correct.
function loadOrCreatePassword(): string {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    const m = fs.readFileSync(CREDENTIALS_FILE, "utf8").match(/^password: (\S+)$/m);
    if (m) return m[1];
  }
  return randomBytes(15).toString("base64url");
}

type Account = { role: (typeof ROLES)[number]; email: string; id: string };

async function seedAccounts(password: string): Promise<Account[]> {
  const accounts: Account[] = [];
  for (const role of ROLES) {
    const email = `seed.${role.replace("_", ".")}@example.com`;

    // The sign-up gate only admits invited emails, even for accounts created by an admin.
    await sql`
      insert into core.invitations (email, expires_at) values (${email}, now() + interval '7 days')
      on conflict ((lower(email))) do nothing`;

    let [existing] = await sql<{ id: string }[]>`select id from auth.users where lower(email) = ${email}`;
    if (!existing) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
      existing = { id: data.user.id };
    }

    await sql.begin(async (tx) => {
      await tx`insert into core.users (id, email, onboarding_tour_seen_at) values (${existing.id}, ${email}, now()) on conflict (id) do nothing`;
      await tx`insert into core.user_roles (user_id, role_slug) values (${existing.id}, 'employee') on conflict do nothing`;
      if (role !== "employee") {
        await tx`insert into core.user_roles (user_id, role_slug) values (${existing.id}, ${role}) on conflict do nothing`;
      }
      await tx`update core.invitations set accepted_at = now() where lower(email) = ${email} and accepted_at is null`;
    });

    accounts.push({ role, email, id: existing.id });
    console.log(`account: ${role.padEnd(12)} ${email}`);
  }
  return accounts;
}

async function seedPeople(accounts: Account[]) {
  const data = buildSeedDataset();
  const crypto = createFieldCrypto(process.env.FIELD_ENCRYPTION_KEYS);

  const clientIds = new Map<string, string>();
  for (const c of data.clients) {
    const [row] = await sql<{ id: string }[]>`
      with ins as (
        insert into core.clients (name, time_zone) values (${c.name}, ${c.timeZone})
        on conflict ((lower(name))) do nothing returning id)
      select id from ins union all select id from core.clients where lower(name) = lower(${c.name}) limit 1`;
    clientIds.set(c.name, row.id);
  }

  let created = 0;
  const employeeIds: string[] = [];
  for (const [i, p] of data.employees.entries()) {
    // The first six people are the people behind the six seeded accounts, so each account has a profile.
    const account = accounts.at(i); // numeric loop index, not user input
    const workEmail = account?.email ?? p.email;

    const [found] = await sql`select id from core.employees where lower(work_email) = ${workEmail}`;
    if (found) {
      employeeIds.push(found.id);
      continue;
    }

    const n = String(i + 1).padStart(3, "0");
    const status = i % 9 === 4 ? "probation" : "active";
    const [emp] = await sql<{ id: string }[]>`
      insert into core.employees
        (user_id, legal_first_name, legal_last_name, work_email, mobile, address_line, city, province, country,
         position, status, worker_type, start_date)
      values
        (${account?.id ?? null}, ${p.firstName}, ${p.lastName}, ${workEmail}, ${`+63 900 000 ${n}0`}, ${`${i + 1} Sample Street (fake)`},
         ${"Cebu City"}, ${"Cebu"}, ${"PH"}, ${p.position}, ${status}, ${"contractor"}, ${p.startDate})
      returning id`;

    await sql`insert into core.employment_history (employee_id, event_type, effective_date, summary)
              values (${emp.id}, 'hired', ${p.startDate}, ${`Added to ELEVATE as ${p.position}`})`;
    await sql`insert into core.client_assignments (employee_id, client_id, start_date, hours_per_week)
              values (${emp.id}, ${clientIds.get(p.client)!}, ${p.startDate}, ${i % 3 === 0 ? 40 : 20})`;

    const plain: Record<SensitiveField, string> = {
      tin: p.sensitive.tin,
      sss: p.sensitive.sss,
      philhealth: p.sensitive.philhealth,
      pagibig: p.sensitive.pagibig,
      bankName: p.sensitive.bankName,
      bankAccountName: `${p.firstName} ${p.lastName}`,
      bankAccountNumber: p.sensitive.bankAccount,
      payRate: p.sensitive.payRatePhpMonthly.toFixed(2),
    };
    const enc = new Map<SensitiveField, string>();
    const masks: Record<string, string> = {};
    for (const f of SENSITIVE_FIELDS) {
      // eslint-disable-next-line security/detect-object-injection -- f is a typed SensitiveField
      const value = plain[f];
      enc.set(f, crypto.encrypt(value, sensitiveContext(f, emp.id)));
      masks[f] = maskFor(f, value); // eslint-disable-line security/detect-object-injection
    }
    await sql`
      insert into core.employee_sensitive
        (employee_id, tin_enc, sss_enc, philhealth_enc, pagibig_enc, bank_name_enc, bank_account_name_enc,
         bank_account_number_enc, pay_rate_enc, masks)
      values
        (${emp.id}, ${enc.get("tin")!}, ${enc.get("sss")!}, ${enc.get("philhealth")!}, ${enc.get("pagibig")!},
         ${enc.get("bankName")!}, ${enc.get("bankAccountName")!}, ${enc.get("bankAccountNumber")!}, ${enc.get("payRate")!},
         ${sql.json(masks)})`;
    employeeIds.push(emp.id);
    created += 1;
  }
  await seedOrganization(data, employeeIds);
  console.log(`people: ${created} created, ${data.employees.length - created} already there; ${data.clients.length} clients`);
}

/**
 * Two departments, six teams, the position catalog and a reporting tree. Safe to repeat: it only fills
 * what is missing. Team leads (the first five people) report to the person at index 4 (the Executive
 * account); everyone else reports to their team lead. The Employee account (index 5) sits in the Team Lead
 * account's team and reports to them, so team access can be tried with seeded accounts.
 */
async function seedOrganization(data: SeedDataset, ids: string[]) {
  const upsert = async (table: "departments" | "teams" | "positions", column: "name" | "title", value: string, extra: { departmentId?: string } = {}) => {
    const [row] = table === "teams"
      ? await sql<{ id: string }[]>`
          with ins as (insert into core.teams (name, department_id) values (${value}, ${extra.departmentId!})
            on conflict ((lower(name))) do nothing returning id)
          select id from ins union all select id from core.teams where lower(name) = lower(${value}) limit 1`
      : table === "departments"
        ? await sql<{ id: string }[]>`
          with ins as (insert into core.departments (name) values (${value}) on conflict ((lower(name))) do nothing returning id)
          select id from ins union all select id from core.departments where lower(name) = lower(${value}) limit 1`
        : await sql<{ id: string }[]>`
          with ins as (insert into core.positions (title) values (${value}) on conflict ((lower(title))) do nothing returning id)
          select id from ins union all select id from core.positions where lower(title) = lower(${value}) limit 1`;
    void column;
    return row.id;
  };

  const services = await upsert("departments", "name", "Client Services");
  const operations = await upsert("departments", "name", "Operations");
  const teamIds: string[] = [];
  for (const t of data.teams) teamIds.push(await upsert("teams", "name", t.name, { departmentId: services }));
  await upsert("teams", "name", "HR & Admin", { departmentId: operations });
  const positionIds = new Map<string, string>();
  for (const t of data.teams) positionIds.set(t.position, await upsert("positions", "title", t.position));

  for (const [i, p] of data.employees.entries()) {
    const id = ids.at(i)!;
    const teamIndex = i === 5 ? 2 : i % 5;
    const managerIndex = i === 4 ? null : i < 4 ? 4 : i === 5 ? 2 : i % 5;
    const teamId = teamIds.at(teamIndex)!;

    await sql`update core.employees set team_id = coalesce(team_id, ${teamId}), position_id = coalesce(position_id, ${positionIds.get(p.position)!}) where id = ${id}`;
    await sql`insert into core.team_memberships (employee_id, team_id, effective_from)
              select ${id}, ${teamId}, ${p.startDate}::date
              where not exists (select 1 from core.team_memberships where employee_id = ${id} and effective_to is null)`;

    if (managerIndex !== null) {
      const managerId = ids.at(managerIndex)!;
      await sql`update core.employees set manager_id = ${managerId} where id = ${id} and manager_id is null`;
      await sql`insert into core.reporting_lines (employee_id, manager_id, effective_from)
                select ${id}, ${managerId}, ${p.startDate}::date
                where not exists (select 1 from core.reporting_lines where employee_id = ${id} and effective_to is null)`;
    }
  }
  console.log(`organization: 2 departments, ${data.teams.length + 1} teams, ${positionIds.size} positions, reporting tree ready`);
}

try {
  const password = loadOrCreatePassword();
  const accounts = await seedAccounts(password);
  await seedPeople(accounts);

  const lines = [
    `# Fake local accounts. Each asks you to set up an authenticator at first sign-in.`,
    `password: ${password}`,
    ...accounts.map((a) => `${a.role}: ${a.email}`),
  ];
  fs.writeFileSync(CREDENTIALS_FILE, lines.join("\n") + "\n");
  console.log(`\nAccounts and password saved to apps/elevate/${CREDENTIALS_FILE} (not committed).`);
} finally {
  await sql.end();
}
