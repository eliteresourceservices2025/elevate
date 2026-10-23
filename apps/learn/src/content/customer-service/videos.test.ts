import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecapPanel } from "@/components/recap-panel";
import { COURSES } from "../index";
import videos from "./videos.json";
import { MODULE_VIDEOS, WELCOME_VIDEO, demoVideos, videosForModule, welcomeVideo } from "./videos";

const media = (name: string) => resolve(__dirname, "../../../media/recaps", name);
const cs = COURSES["customer-service"];

describe("the Customer Service lesson videos", () => {
  it("play only in modules that exist, each video once, and the welcome video is not in a module", () => {
    const keys = cs.content.modules.map((m) => m.key);
    for (const k of Object.keys(MODULE_VIDEOS)) expect(keys, k).toContain(k);
    const used = Object.values(MODULE_VIDEOS).flat();
    expect(new Set(used).size).toBe(used.length);
    expect(used).not.toContain(WELCOME_VIDEO);
    for (const id of [...used, WELCOME_VIDEO]) expect((videos as { id: string }[]).some((v) => v.id === id), id).toBe(true);
  });

  it("holds back the three worked mock calls, which show model answers close to the graded call", () => {
    const ids = (videos as { id: string }[]).map((v) => v.id);
    expect(ids.filter((i) => i.startsWith("cs-11") || i.startsWith("cs-12") || i.startsWith("cs-13"))).toEqual([]);
    for (const n of ["cs-11-mock-call-routine-inquiry", "cs-12-mock-call-frustrated-family", "cs-13-mock-call-supervisor-request"]) {
      expect(existsSync(media(`customer-service-${n}.mp4`)), n).toBe(false);
    }
  });

  it("has every file in the private folder (the video), of a sensible size, and none in public/", () => {
    for (const v of videos as { id: string; seconds: number; transcript: string[] }[]) {
      const mp4 = media(`customer-service-${v.id}.mp4`);
      expect(existsSync(mp4), v.id).toBe(true);
      expect(statSync(mp4).size, v.id).toBeGreaterThan(200_000);
      expect(statSync(mp4).size, v.id).toBeLessThan(6_000_000);
      expect(existsSync(resolve(__dirname, "../../../public/recaps", `customer-service-${v.id}.mp4`)), v.id).toBe(false);
      expect(v.seconds).toBeGreaterThan(50);
      expect(v.transcript.length).toBeGreaterThan(5);
      for (const t of v.transcript) expect(t).not.toMatch(/[<>]|https?:\/\//);
    }
  });

  it("gives each view a signed-in path and a transcript (the subtitles are in the picture), and nothing for another course", () => {
    const [first] = videosForModule("customer-service", "listening");
    expect(first.file).toMatch(/^\/api\/recaps\/customer-service-cs-\d\d-[a-z-]+\.mp4$/);
    expect("captions" in first).toBe(false); // the subtitles are burned into the picture
    expect(videosForModule("customer-service", "listening")).toHaveLength(3);
    expect(videosForModule("customer-service", "no_such_module")).toEqual([]);
    // every module of the course now has at least one video, and the three worked example calls come before the mock call
    for (const m of cs.content.modules) expect(videosForModule("customer-service", m.key).length, m.key).toBeGreaterThan(0);
    expect(demoVideos("customer-service")).toHaveLength(3);
    expect(demoVideos("hipaa")).toEqual([]);
    expect(videosForModule("hipaa", "listening")).toEqual([]);
    expect(welcomeVideo("customer-service")?.label).toBe("Welcome to the course");
    expect(welcomeVideo("hipaa")).toBeNull();
  });

  it("renders a titled, optional, download-free player with its transcript", () => {
    const html = renderToStaticMarkup(createElement(RecapPanel, { recap: videosForModule("customer-service", "excellence")[0], title: "Excellence" }));
    expect(html).toContain("Optional video: Our role and what families need");
    expect(html).toContain('controlsList="nodownload noremoteplayback"');
    expect(html).not.toContain("<track"); // a second set of subtitles would double the burned-in ones
    expect(html).toContain("Read the video as text");
    expect(html).toContain("This video is optional");
    expect(html).not.toMatch(/autoplay/i);
  });
});
