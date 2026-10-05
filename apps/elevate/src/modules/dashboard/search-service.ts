import "server-only";
import { and, asc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor, type AuthzUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { listAnnouncements } from "@/modules/announcements/queries";
import { getMyAssets, listAssets, listTeamAssets } from "@/modules/assets/queries";
import { employees } from "@/modules/people/schema";
import { applications, candidates, jobOpenings } from "@/modules/recruiting/schema";
import { reportName } from "@/modules/org/service";
import { cleanQuery, escapeLike, type SearchHit } from "./search";

const PER_SOURCE = 5;

async function orNone<T>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError) return [];
    throw error;
  }
}

/**
 * Looks across what this person may see, source by source, each with its owner's own rule: everyone finds colleagues in the
 * directory (name, position, team: the same fields the directory shows), HR and recruiters find applicants, HR finds any
 * equipment while a team lead or employee finds only theirs, announcements are the ones the person can read.
 * Returns titles and links only: no sensitive field is ever in a result.
 */
export async function runSearch(user: AuthzUser, rawQuery: string): Promise<SearchHit[]> {
  await authorize(user, "search.use", { ownerUserId: user.id });
  const q = cleanQuery(rawQuery);
  if (!q) return [];
  const like = `%${escapeLike(q)}%`;
  const lower = q.toLowerCase();

  const [people, assetHits, applicants, notices] = await Promise.all([
    orNone(async () => {
      await authorize(user, "people.view_directory");
      // A full profile opens for HR (all scope); for anyone else the link goes to the directory, which every role may open.
      const seesProfiles = scopeFor(user, "people.view_profile") === "all";
      const rows = await db
        .select({ id: employees.id, number: employees.employeeNumber, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, position: employees.position })
        .from(employees)
        .where(
          and(
            isNull(employees.archivedAt),
            ne(employees.status, "separated"),
            or(ilike(employees.legalFirstName, like), ilike(employees.legalLastName, like), ilike(employees.preferredName, like), ilike(employees.workEmail, like), ilike(employees.employeeNumber, like), ilike(employees.position, like)),
          ),
        )
        .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName))
        .limit(PER_SOURCE);
      return rows.map<SearchHit>((r) => ({
        kind: "person",
        title: reportName({ first: r.first, last: r.last, preferred: r.preferred }),
        subtitle: [r.position, r.number].filter(Boolean).join(" · "),
        href: seesProfiles ? `/people/${r.id}` : `/people?q=${encodeURIComponent(r.number)}`,
      }));
    }),
    orNone(async () => {
      const scope = scopeFor(user, "assets.view");
      if (scope === "all") {
        const { rows } = await listAssets({ q }, { page: 1, pageSize: PER_SOURCE });
        return rows.map<SearchHit>((a) => ({ kind: "asset", title: `${a.tag} · ${a.name}`, subtitle: a.holder ? `With ${a.holder.name}` : a.status.replace("_", " "), href: `/assets/${a.tag}` }));
      }
      // A team lead or employee only ever finds what is (or was) with the people they may see.
      const held = scope === "team" ? await listTeamAssets() : scope === "own" ? await getMyAssets() : [];
      return held
        .filter((a) => a.tag.toLowerCase().includes(lower) || a.name.toLowerCase().includes(lower))
        .slice(0, PER_SOURCE)
        .map<SearchHit>((a) => ({ kind: "asset", title: `${a.tag} · ${a.name}`, subtitle: a.holder ? `With ${a.holder}` : "With you", href: `/assets/${a.tag}` }));
    }),
    orNone(async () => {
      // Applicants are for HR, Super Admin and recruiters (the "all" scope); a team lead sees only their own hiring team's board.
      if (scopeFor(user, "recruiting.view") !== "all") return [];
      const rows = await db
        .select({ id: applications.id, name: candidates.fullName, job: jobOpenings.title })
        .from(applications)
        .innerJoin(candidates, eq(candidates.id, applications.candidateId))
        .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
        .where(and(isNull(candidates.anonymizedAt), or(ilike(candidates.fullName, like), ilike(candidates.email, like))))
        .orderBy(asc(candidates.fullName))
        .limit(PER_SOURCE);
      return rows.map<SearchHit>((r) => ({ kind: "applicant", title: r.name, subtitle: r.job, href: `/recruiting/applications/${r.id}` }));
    }),
    orNone(async () => {
      const items = await listAnnouncements({ limit: 50 });
      return items
        .filter((a) => a.title.toLowerCase().includes(lower))
        .slice(0, PER_SOURCE)
        .map<SearchHit>((a) => ({ kind: "announcement", title: a.title, href: `/announcements/${a.id}` }));
    }),
  ]);

  return [...people, ...applicants, ...assetHits, ...notices];
}
