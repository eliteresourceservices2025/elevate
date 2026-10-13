import type { CourseContent, QuestionSeed } from "../../../../learn/src/content/schema";

// What changed between two versions of a course, in words a reviewer can scan: modules and screens added, removed or reworded,
// the responsibility statement, the exam rules, and exam questions (matched by lineage, then by identical wording).
// Pure (no database).

export type DiffQuestion = QuestionSeed & { lineage: string };

export type CourseDiff = {
  title: { from: string; to: string } | null;
  attestation: { from: string; to: string; versionChanged: boolean } | null;
  examConfig: { from: unknown; to: unknown } | null;
  modules: {
    added: string[];
    removed: string[];
    changed: { key: string; title: string; changes: string[]; screens: { added: string[]; removed: string[]; changed: string[] } }[];
  };
  questions: {
    added: { moduleKey: string; stem: string }[];
    removed: { moduleKey: string; stem: string }[];
    changed: { moduleKey: string; stem: string; what: string[] }[];
  };
  unchanged: boolean;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffCourses(a: { content: CourseContent; examConfig: unknown; questions: DiffQuestion[] }, b: { content: CourseContent; examConfig: unknown; questions: DiffQuestion[] }): CourseDiff {
  const out: CourseDiff = {
    title: a.content.title === b.content.title ? null : { from: a.content.title, to: b.content.title },
    attestation: same(a.content.attestation, b.content.attestation)
      ? null
      : { from: a.content.attestation.text, to: b.content.attestation.text, versionChanged: a.content.attestation.version !== b.content.attestation.version },
    examConfig: same(a.examConfig, b.examConfig) ? null : { from: a.examConfig, to: b.examConfig },
    modules: { added: [], removed: [], changed: [] },
    questions: { added: [], removed: [], changed: [] },
    unchanged: false,
  };

  const aMods = new Map(a.content.modules.map((m) => [m.key, m]));
  const bMods = new Map(b.content.modules.map((m) => [m.key, m]));
  for (const [key, m] of bMods) if (!aMods.has(key)) out.modules.added.push(m.title);
  for (const [key, m] of aMods) if (!bMods.has(key)) out.modules.removed.push(m.title);
  for (const [key, mb] of bMods) {
    const ma = aMods.get(key);
    if (!ma) continue;
    const changes: string[] = [];
    if (ma.title !== mb.title) changes.push(`title: "${ma.title}" to "${mb.title}"`);
    if (ma.summary !== mb.summary) changes.push("summary");
    if (ma.estimatedMinutes !== mb.estimatedMinutes) changes.push(`minutes: ${ma.estimatedMinutes} to ${mb.estimatedMinutes}`);
    if (!same([...ma.tracks].sort(), [...mb.tracks].sort())) changes.push(`tracks: ${ma.tracks.join(", ")} to ${mb.tracks.join(", ")}`);
    if (!same(ma.keyPoints, mb.keyPoints)) changes.push("key points");
    const aScreens = new Map(ma.screens.map((s) => [s.id, s]));
    const bScreens = new Map(mb.screens.map((s) => [s.id, s]));
    const screens = {
      added: [...bScreens].filter(([id]) => !aScreens.has(id)).map(([, s]) => s.title),
      removed: [...aScreens].filter(([id]) => !bScreens.has(id)).map(([, s]) => s.title),
      changed: [...bScreens].filter(([id, s]) => aScreens.has(id) && !same(aScreens.get(id), s)).map(([, s]) => s.title),
    };
    if (!same(ma.screens.map((s) => s.id), mb.screens.map((s) => s.id)) && screens.added.length === 0 && screens.removed.length === 0) changes.push("screen order");
    if (changes.length > 0 || screens.added.length || screens.removed.length || screens.changed.length) out.modules.changed.push({ key, title: mb.title, changes, screens });
  }

  // Questions: match by lineage, else by identical wording.
  const bByLineage = new Map(b.questions.map((q) => [q.lineage, q]));
  const bByStem = new Map(b.questions.map((q) => [q.stem.trim().toLowerCase(), q]));
  const matched = new Set<string>();
  for (const qa of a.questions) {
    const qb = bByLineage.get(qa.lineage) ?? bByStem.get(qa.stem.trim().toLowerCase());
    if (!qb) {
      out.questions.removed.push({ moduleKey: qa.moduleKey, stem: qa.stem });
      continue;
    }
    matched.add(qb.lineage);
    const what: string[] = [];
    if (qa.stem !== qb.stem) what.push("wording");
    if (!same(qa.options, qb.options)) what.push("options");
    if (!same([...qa.correctIds].sort(), [...qb.correctIds].sort())) what.push("answer key");
    if (qa.rationale !== qb.rationale) what.push("reason");
    if (qa.topic !== qb.topic) what.push("topic");
    if (qa.moduleKey !== qb.moduleKey) what.push("module");
    if (what.length > 0) out.questions.changed.push({ moduleKey: qb.moduleKey, stem: qb.stem, what });
  }
  for (const qb of b.questions) if (!matched.has(qb.lineage)) out.questions.added.push({ moduleKey: qb.moduleKey, stem: qb.stem });

  out.unchanged =
    !out.title &&
    !out.attestation &&
    !out.examConfig &&
    out.modules.added.length === 0 &&
    out.modules.removed.length === 0 &&
    out.modules.changed.length === 0 &&
    out.questions.added.length === 0 &&
    out.questions.removed.length === 0 &&
    out.questions.changed.length === 0;
  return out;
}
