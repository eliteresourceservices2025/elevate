// A sample exam for the studio (Release 3, "preview the exam"): the questions an exam on one track would draw from this draft,
// spread across the track's modules the way `learn.start_exam` does (the nth-best of every module before the (n+1)th of any), in a
// random order, with the exam rules next to it. Pure and seedable, so the same seed shows the same sample. Nothing is recorded.

export type PreviewQuestion = { id: string; moduleKey: string; topic: string; stem: string; options: { id: string; text: string }[]; correctIds: string[]; type: string };

/** A small seeded random generator (mulberry32): the same seed always gives the same numbers. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type ExamSample = {
  questions: (PreviewQuestion & { shuffledOptions: { id: string; text: string }[] })[];
  /** Questions available for the track, per module key. */
  pool: Record<string, number>;
  /** True when the track has fewer questions than the exam asks for (the exam would refuse to start). */
  short: boolean;
};

export function sampleExam(all: readonly PreviewQuestion[], trackModuleKeys: readonly string[], count: number, seed: number): ExamSample {
  const random = seeded(seed);
  const keys = new Set(trackModuleKeys);
  const inTrack = all.filter((q) => keys.has(q.moduleKey));
  const pool: Record<string, number> = {};
  for (const q of inTrack) pool[q.moduleKey] = (pool[q.moduleKey] ?? 0) + 1;

  // rank within a module at random, then take every module's first, then every module's second, and so on
  const ranked = new Map<string, PreviewQuestion[]>();
  for (const q of shuffle(inTrack, random)) ranked.set(q.moduleKey, [...(ranked.get(q.moduleKey) ?? []), q]);
  const rows: { q: PreviewQuestion; rank: number; tie: number }[] = [];
  for (const list of ranked.values()) list.forEach((q, rank) => rows.push({ q, rank, tie: random() }));
  rows.sort((a, b) => a.rank - b.rank || a.tie - b.tie);
  const chosen = shuffle(rows.slice(0, count).map((r) => r.q), random);
  return {
    questions: chosen.map((q) => ({ ...q, shuffledOptions: shuffle(q.options, random) })),
    pool,
    short: inTrack.length < count,
  };
}
