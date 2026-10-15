// The course-improvement statistics HR sees in the studio (Release 3): how often each question and module is missed and how long
// modules take. Counts and percentages only, never a person; a group of fewer than five people is hidden. Pure, so it is tested
// without a database; `studio-queries.ts` supplies the rows.

/** A figure built from fewer people than this is not shown (the same rule as ELEVATE analytics). */
export const LEARN_MIN_GROUP = 5;

export type QuestionRow = { id: string; moduleKey: string; topic: string; stem: string; people: number; shown: number; missed: number };
export type ModuleRow = { key: string; title: string; people: number; avgMinutes: number | null; answered: number; missed: number; peopleAnswered: number };

export type QuestionStat = { id: string; moduleKey: string; topic: string; stem: string; shown: number; missPercent: number } | { id: string; moduleKey: string; topic: string; stem: string; hidden: true };
export type ModuleStat = { key: string; title: string; people: number; avgMinutes: number | null; missPercent: number | null; hidden: boolean };

const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((1000 * part) / whole) / 10);

/** Questions with enough people, most missed first; the rest are listed as hidden so editors know data exists but is too thin. */
export function questionStats(rows: readonly QuestionRow[]): QuestionStat[] {
  const shownRows: QuestionStat[] = rows
    .filter((r) => r.people >= LEARN_MIN_GROUP)
    .map((r) => ({ id: r.id, moduleKey: r.moduleKey, topic: r.topic, stem: r.stem, shown: r.shown, missPercent: pct(r.missed, r.shown) }))
    .sort((a, b) => b.missPercent - a.missPercent || b.shown - a.shown);
  const hidden: QuestionStat[] = rows.filter((r) => r.people > 0 && r.people < LEARN_MIN_GROUP).map((r) => ({ id: r.id, moduleKey: r.moduleKey, topic: r.topic, stem: r.stem, hidden: true as const }));
  return [...shownRows, ...hidden];
}

/** Module figures: time and miss rate each need five people. */
export function moduleStats(rows: readonly ModuleRow[]): ModuleStat[] {
  return rows.map((r) => {
    const timeOk = r.people >= LEARN_MIN_GROUP;
    const missOk = r.peopleAnswered >= LEARN_MIN_GROUP;
    return {
      key: r.key,
      title: r.title,
      people: timeOk ? r.people : 0,
      avgMinutes: timeOk && r.avgMinutes !== null ? Math.round(r.avgMinutes * 10) / 10 : null,
      missPercent: missOk ? pct(r.missed, r.answered) : null,
      hidden: !timeOk && !missOk,
    };
  });
}

export type PracticeRow = { quarter: string; people: number; correct: number };
export type PracticeStat = { quarter: string; people: number; correctPercent: number } | { quarter: string; hidden: true };

/** Quarterly practice: how many people answered and what share chose the better answer; fewer than five people are hidden. Newest first. */
export function practiceStats(rows: readonly PracticeRow[]): PracticeStat[] {
  return [...rows]
    .sort((a, b) => b.quarter.localeCompare(a.quarter))
    .map((r) => (r.people >= LEARN_MIN_GROUP ? { quarter: r.quarter, people: r.people, correctPercent: pct(r.correct, r.people) } : { quarter: r.quarter, hidden: true as const }));
}
