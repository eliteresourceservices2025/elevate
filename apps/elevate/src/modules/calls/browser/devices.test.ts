import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_CHOICE, deviceConstraint, loadChosen, saveChosen, splitDevices, stillThere } from "./devices";

describe("splitDevices", () => {
  it("sorts microphones, cameras and speakers and keeps their names", () => {
    const out = splitDevices([
      { kind: "audioinput", deviceId: "m1", label: "Headset microphone" },
      { kind: "videoinput", deviceId: "c1", label: "HD webcam" },
      { kind: "audiooutput", deviceId: "s1", label: "Headset" },
      { kind: "audioinput", deviceId: "m2", label: "Laptop microphone" },
    ]);
    expect(out.mics.map((d) => d.label)).toEqual(["Headset microphone", "Laptop microphone"]);
    expect(out.cams).toEqual([{ id: "c1", label: "HD webcam" }]);
    expect(out.speakers).toEqual([{ id: "s1", label: "Headset" }]);
  });
  it("gives numbered names before the browser has allowed access (labels are empty) and skips entries without an id", () => {
    const out = splitDevices([
      { kind: "audioinput", deviceId: "a", label: "" },
      { kind: "audioinput", deviceId: "b", label: "  " },
      { kind: "videoinput", deviceId: "c", label: "" },
      { kind: "videoinput", deviceId: "", label: "x" },
    ]);
    expect(out.mics.map((d) => d.label)).toEqual(["Microphone 1", "Microphone 2"]);
    expect(out.cams.map((d) => d.label)).toEqual(["Camera 1"]);
  });
});

describe("stillThere and deviceConstraint", () => {
  const list = [{ id: "a", label: "A" }];
  it("keeps a saved device that is still plugged in, drops one that is gone", () => {
    expect(stillThere("a", list)).toBe("a");
    expect(stillThere("gone", list)).toBeNull();
    expect(stillThere(null, list)).toBeNull();
  });
  it("asks for the exact device when one was chosen, the default otherwise", () => {
    expect(deviceConstraint("a")).toEqual({ deviceId: { exact: "a" } });
    expect(deviceConstraint(null)).toBe(true);
  });
});

describe("the saved choice", () => {
  afterEach(() => vi.unstubAllGlobals());
  const fakeStorage = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) } });
    return data;
  };
  it("is remembered and read back", () => {
    fakeStorage();
    saveChosen({ mic: "m1", cam: null, speaker: "s1" });
    expect(loadChosen()).toEqual({ mic: "m1", cam: null, speaker: "s1" });
  });
  it("falls back to the defaults when nothing is saved, the saved text is junk, or storage is blocked", () => {
    fakeStorage();
    expect(loadChosen()).toEqual(NO_CHOICE);
    fakeStorage({ "elevate.call.devices": "not json" });
    expect(loadChosen()).toEqual(NO_CHOICE);
    fakeStorage({ "elevate.call.devices": JSON.stringify({ mic: 5, cam: "x".repeat(400), speaker: "ok" }) });
    expect(loadChosen()).toEqual({ mic: null, cam: null, speaker: "ok" });
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    expect(loadChosen()).toEqual(NO_CHOICE);
    expect(() => saveChosen(NO_CHOICE)).not.toThrow();
  });
});
