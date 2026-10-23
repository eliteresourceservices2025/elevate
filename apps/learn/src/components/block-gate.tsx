"use client";

import { createContext, useContext, useId, useLayoutEffect, useMemo, useState } from "react";

// "Answer before you move on". A block that asks the learner to do something (a quiz question, a mini game, a sort) tells the lesson
// stage whether it is finished, and the stage keeps Next switched off until every such block on the slide is. Finished means answered,
// not right: all of it is practice, so a wrong answer still teaches (the feedback is shown) and nobody can get stuck. Outside a stage
// (the course preview) there is no gate and nothing changes.

type Gate = { set: (id: string, done: boolean) => void; remove: (id: string) => void };
const GateContext = createContext<Gate | null>(null);
export const GateProvider = GateContext.Provider;

/** The block types that ask the learner to do something. A slide holding one waits for it, even in the moment before its blocks have mounted. */
export const GATED_TYPES: ReadonlySet<string> = new Set(["scenario", "check", "sort", "cards", "spot", "hotspot", "build", "branch", "game"]);

/**
 * The stage's side. Blocks are filed under the slide they are on, so a slide that is still fading out can never be mistaken for the one
 * coming in. `pending` is how many blocks on THIS slide are still waiting for an answer, and `total` how many it has.
 */
export function useGateState(screenId: string): { pending: number; total: number; gate: Gate } {
  const [map, setMap] = useState<Record<string, boolean>>({});
  const gate = useMemo<Gate>(
    () => ({
      set: (id, done) => setMap((m) => (m[`${screenId}|${id}`] === done ? m : { ...m, [`${screenId}|${id}`]: done })),
      remove: (id) =>
        setMap((m) => {
          const key = `${screenId}|${id}`;
          if (!(key in m)) return m;
          const next = { ...m };
          delete next[key];
          return next;
        }),
    }),
    [screenId],
  );
  const mine = Object.entries(map).filter(([k]) => k.startsWith(`${screenId}|`));
  return { pending: mine.filter(([, done]) => !done).length, total: mine.length, gate };
}

/** The block's side: call it with whether the learner has finished this block. Does nothing outside a stage. */
export function useBlockGate(done: boolean): void {
  const gate = useContext(GateContext);
  const id = useId();
  // layout effects, so a block registers before it is first painted
  useLayoutEffect(() => {
    gate?.set(id, done);
  }, [gate, id, done]);
  useLayoutEffect(() => () => gate?.remove(id), [gate, id]);
}
