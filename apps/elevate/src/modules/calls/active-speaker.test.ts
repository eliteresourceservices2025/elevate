import { describe, expect, it } from "vitest";
import { nextSpeaker, QUIET_TICKS, type SpeakerState } from "./active-speaker";

const none: SpeakerState = { id: null, quiet: 0 };

describe("nextSpeaker", () => {
  it("nobody speaks while everyone is below the floor", () => {
    expect(nextSpeaker({ a: 0.001, b: 0.01 }, none)).toEqual(none);
    expect(nextSpeaker({}, none)).toEqual(none);
  });

  it("the first person to speak up becomes the speaker", () => {
    expect(nextSpeaker({ a: 0.2, b: 0.01 }, none)).toEqual({ id: "a", quiet: 0 });
  });

  it("the current speaker keeps the spot against a slightly louder person, but not a much louder one", () => {
    const a: SpeakerState = { id: "a", quiet: 0 };
    expect(nextSpeaker({ a: 0.2, b: 0.25 }, a).id).toBe("a");
    expect(nextSpeaker({ a: 0.1, b: 0.4 }, a).id).toBe("b");
  });

  it("a speaker who goes quiet keeps the spot for a few ticks, then loses it", () => {
    let state: SpeakerState = { id: "a", quiet: 0 };
    for (let i = 0; i < QUIET_TICKS - 1; i++) {
      state = nextSpeaker({ a: 0, b: 0 }, state);
      expect(state.id).toBe("a");
    }
    expect(nextSpeaker({ a: 0, b: 0 }, state)).toEqual({ id: null, quiet: 0 });
  });

  it("when the current speaker pauses and someone else talks, the switch waits a moment, then happens", () => {
    let state: SpeakerState = { id: "a", quiet: 0 };
    state = nextSpeaker({ a: 0, b: 0.2 }, state);
    expect(state.id).toBe("a");
    for (let i = 0; i < QUIET_TICKS; i++) state = nextSpeaker({ a: 0, b: 0.2 }, state);
    expect(state.id).toBe("b");
  });

  it("ignores levels that are not numbers", () => {
    expect(nextSpeaker({ a: Number.NaN, b: Number.POSITIVE_INFINITY }, none)).toEqual(none);
    expect(nextSpeaker({ a: Number.NaN }, none)).toEqual(none);
  });
});
