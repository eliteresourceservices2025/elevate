// Deterministic FAKE people data for development and tests. Real data exists only in production.
// Every ID uses an obviously fake prefix, so nothing here can be mistaken for a real record.

export type SeedTeam = { name: string; position: string };
export type SeedClient = { name: string; timeZone: string };

export type SeedSensitive = {
  tin: string;
  sss: string;
  philhealth: string;
  pagibig: string;
  bankName: string;
  bankAccount: string;
  payRatePhpMonthly: number;
};

export type SeedEmployee = {
  firstName: string;
  lastName: string;
  email: string;
  team: string;
  client: string;
  position: string;
  isTeamLead: boolean;
  startDate: string; // YYYY-MM-DD
  sensitive: SeedSensitive;
};

export type SeedDataset = { teams: SeedTeam[]; clients: SeedClient[]; employees: SeedEmployee[] };

export const SEED_EMAIL_DOMAIN = "example.com";

const TEAMS: SeedTeam[] = [
  { name: "Healthcare Admin", position: "Healthcare Virtual Assistant" },
  { name: "Executive Support", position: "Executive Virtual Assistant" },
  { name: "Legal Support", position: "Legal Virtual Assistant" },
  { name: "Real Estate", position: "Real Estate Virtual Assistant" },
  { name: "Bookkeeping", position: "Bookkeeping Virtual Assistant" },
];

// Fictional companies. Arizona has no daylight saving; the rest do.
const CLIENTS: SeedClient[] = [
  { name: "Sunrise Family Clinic (fake)", timeZone: "America/Phoenix" },
  { name: "Harbor Legal Group (fake)", timeZone: "America/New_York" },
  { name: "Lone Star Realty (fake)", timeZone: "America/Chicago" },
  { name: "Summit Dental Care (fake)", timeZone: "America/Denver" },
  { name: "Pacific Ledger Partners (fake)", timeZone: "America/Los_Angeles" },
  { name: "Maple Street Pediatrics (fake)", timeZone: "America/New_York" },
];

const FIRST_NAMES = [
  "Maria", "Jose", "Angelica", "Mark", "Kristine", "John Paul", "Bianca", "Carlo", "Jasmine", "Rafael",
  "Sophia", "Miguel", "Patricia", "Gabriel", "Nicole", "Daniel", "Andrea", "Joshua", "Camille", "Paolo",
  "Emily", "Jacob", "Olivia", "Ethan", "Hannah", "Logan", "Grace", "Tyler", "Megan", "Brandon",
  "Lea", "Enzo", "Trisha", "Migs", "Ana", "Ramon", "Charlene", "Noel", "Denise", "Victor",
];

const LAST_NAMES = [
  "Santos", "Reyes", "Cruz", "Bautista", "Garcia", "Mendoza", "Torres", "Villanueva", "Ramos", "Aquino",
  "Dela Cruz", "Castillo", "Flores", "Navarro", "Domingo", "Miller", "Johnson", "Davis", "Wilson", "Clark",
  "Lopez", "Hernandez", "Soriano", "Pascual", "Lim", "Tan", "Gonzales", "Rivera", "Morales", "Salazar",
  "Fernandez", "Del Rosario", "Mercado", "Valdez", "Aguilar", "Bell", "Young", "King", "Wright", "Scott",
];

const BANKS = ["Test Bank of Manila", "Sample Savings Bank", "Fake Union Bank"];

/** Small seeded PRNG (mulberry32) so the dataset is the same on every run. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");

export function buildSeedDataset(count = 40, seed = 20260930): SeedDataset {
  const rand = prng(seed);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)];

  const employees: SeedEmployee[] = [];
  const usedEmails = new Set<string>();

  for (let i = 0; i < count; i++) {
    const team = TEAMS[i % TEAMS.length];
    const client = CLIENTS[i % CLIENTS.length];
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length];

    let email = `${slug(firstName)}.${slug(lastName)}@${SEED_EMAIL_DOMAIN}`;
    for (let n = 2; usedEmails.has(email); n++) email = `${slug(firstName)}.${slug(lastName)}${n}@${SEED_EMAIL_DOMAIN}`;
    usedEmails.add(email);

    const n = i + 1;
    const serial = pad(n, 4);
    const year = 2021 + Math.floor(rand() * 5);

    employees.push({
      firstName,
      lastName,
      email,
      team: team.name,
      client: client.name,
      position: team.position,
      isTeamLead: i < TEAMS.length, // the first person on each team leads it
      startDate: `${year}-${pad(1 + Math.floor(rand() * 12), 2)}-${pad(1 + Math.floor(rand() * 28), 2)}`,
      sensitive: {
        tin: `000-000-${pad(n, 3)}-000`,
        sss: `00-${pad(n, 7)}-0`,
        philhealth: `00-${pad(n, 9)}-0`,
        pagibig: `0000-0000-${pad(n, 4)}`,
        bankName: pick(BANKS),
        bankAccount: `FAKE-${serial}-${pad(Math.floor(rand() * 1_000_000), 6)}`,
        payRatePhpMonthly: 18000 + Math.floor(rand() * 20) * 1000,
      },
    });
  }

  return { teams: TEAMS, clients: CLIENTS, employees };
}
