// Pure rules for loading TalentHR's applicants into ELEVATE recruiting. No database.

export type ElevateStage = "applied" | "screening" | "interview" | "assessment" | "offer";

// A step that means the application is over (hired, rejected, disqualified, withdrawn, archived): those are archived, not loaded.
const TERMINAL = /hire|reject|disqual|declin|withdr|not[ _-]?(select|suit|fit|progress)|archiv|closed|talent[ _-]?pool|unsuccessful/i;

export const isTerminalStep = (name?: string | null, slug?: string | null) => TERMINAL.test(`${name ?? ""} ${slug ?? ""}`);

/** Which ELEVATE stage a TalentHR step is closest to. Unknown steps start at "applied". */
export function stageForStep(name?: string | null, slug?: string | null): ElevateStage {
  const t = `${name ?? ""} ${slug ?? ""}`.toLowerCase();
  if (/offer/.test(t)) return "offer";
  if (/interview/.test(t)) return "interview";
  if (/assess|test|task|skill|exam|trial|demo/.test(t)) return "assessment";
  if (/screen|phone|review|short[ _-]?list|qualif|call/.test(t)) return "screening";
  return "applied";
}

export type ApplicantRow = {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  application?: { id: number; is_disqualified?: boolean | null; deleted_at?: string | null; application_step_id?: number | null } | null;
};
export type StepLike = { id: number; name: string; slug: string };

/** The applicants worth loading: they have an application that is not deleted or disqualified, a usable email, and a step that is not an ending. */
export function activeApplicants<T extends ApplicantRow>(rows: readonly T[], steps: readonly StepLike[]): { row: T; stage: ElevateStage }[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const out: { row: T; stage: ElevateStage }[] = [];
  for (const row of rows) {
    const app = row.application;
    if (!app || app.deleted_at || app.is_disqualified) continue;
    if (!row.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email.trim())) continue;
    const step = app.application_step_id != null ? byId.get(app.application_step_id) : undefined;
    if (step && isTerminalStep(step.name, step.slug)) continue;
    out.push({ row, stage: stageForStep(step?.name, step?.slug) });
  }
  return out;
}
