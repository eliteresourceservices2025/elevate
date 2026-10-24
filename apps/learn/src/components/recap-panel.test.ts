import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { findRecap, recapFile, recapSeconds, recapTranscript } from "@/content/recaps";
import { RecapPanel } from "./recap-panel";

describe("the recap panel", () => {
  const r = findRecap("hipaa", "associates")!;
  const html = renderToStaticMarkup(createElement(RecapPanel, { recap: { file: recapFile(r), seconds: recapSeconds(r), transcript: recapTranscript(r) }, title: "Business associates" }));

  it("is optional and opens in a pop-up (a dialog), with a video that is not loaded until played and does not autoplay", () => {
    expect(html).toContain("<dialog");
    expect(html).toContain("Watch the");
    expect(html).toContain('preload="none"');
    expect(html).not.toMatch(/autoplay/i);
    expect(html).toContain('src="/api/recaps/hipaa-associates.mp4"');
  });

  it("has no download button, no picture-in-picture and no casting", () => {
    expect(html).toContain('controlsList="nodownload noremoteplayback"');
    expect(html).toContain("disablePictureInPicture");
    expect(html).toContain("disableRemotePlayback");
  });

  it("gives the same words as text, says it has no sound, and reminds that the module is the required part", () => {
    expect(html).toContain("voice-over");
    expect(html).toContain("captions on screen");
    expect(html).not.toMatch(/muted/);
    expect(html).toContain("Read the recap as text");
    expect(html).toContain("A business associate does work for a covered entity");
    expect(html).toContain("required part");
  });
});
