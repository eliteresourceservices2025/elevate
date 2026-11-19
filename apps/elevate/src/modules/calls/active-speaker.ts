// Who is speaking, from how loud each person is right now. Pure functions so the rule can be tested: a speaker must be clearly louder than
// the quiet floor, and the current speaker keeps the spot until someone is clearly louder or they have been quiet for a moment, so the
// tiles don't jump around on every cough. Used to pick whose video to pull first in a big meeting.

export const SPEAKING_LEVEL = 0.03;
/** A newcomer must be this many times louder than the current speaker to take over while the current one is still talking. */
export const TAKEOVER_RATIO = 1.6;
/** Ticks (about 0.4 s each) the current speaker may stay quiet before they lose the spot. */
export const QUIET_TICKS = 4;

export type SpeakerState = { id: string | null; quiet: number };

export function nextSpeaker(levels: Record<string, number>, state: SpeakerState): SpeakerState {
  const entries = Object.entries(levels).filter(([, level]) => Number.isFinite(level) && level >= SPEAKING_LEVEL);
  if (entries.length === 0) {
    if (state.id === null) return state;
    return state.quiet + 1 >= QUIET_TICKS ? { id: null, quiet: 0 } : { id: state.id, quiet: state.quiet + 1 };
  }
  const [loudestId, loudest] = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  const currentLevel = state.id ? (levels[state.id] ?? 0) : 0;
  if (state.id && currentLevel >= SPEAKING_LEVEL) {
    // The current speaker is still talking: keep them unless someone is clearly louder.
    return loudestId !== state.id && loudest >= currentLevel * TAKEOVER_RATIO ? { id: loudestId, quiet: 0 } : { id: state.id, quiet: 0 };
  }
  // The current speaker is quiet (or there was none): someone else is speaking, but give a short pause its due before switching.
  if (state.id && state.quiet + 1 < QUIET_TICKS && loudestId !== state.id) return { id: state.id, quiet: state.quiet + 1 };
  return { id: loudestId, quiet: 0 };
}
