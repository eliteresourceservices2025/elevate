import React from "react";
import { Composition, registerRoot } from "remotion";
import { Recap, totalFrames } from "./Recap.jsx";
import { CsVideo, csTotalFrames } from "./Cs.jsx";
import "./LearnScenes.jsx";

const Root = () => (
  <>
    <Composition
      id="Recap"
      component={Recap}
      width={1280}
      height={720}
      fps={30}
      durationInFrames={30 * 70}
      defaultProps={{ recap: { courseTitle: "HIPAA", moduleNumber: 1, moduleCount: 10, title: "Preview", scenes: [], scenesSeconds: [], intro: 4, outro: 4 } }}
      calculateMetadata={({ props }) => ({ durationInFrames: totalFrames(props.recap) })}
    />
    <Composition
      id="CsVideo"
      component={CsVideo}
      width={1280}
      height={720}
      fps={30}
      durationInFrames={30 * 70}
      defaultProps={{ video: { n: 1, count: 12, title: "Preview", scenes: [], scenesSeconds: [], intro: 4, outro: 4, narration: { folder: "", scenes: [], outroCues: [], music: "music.wav" } } }}
      calculateMetadata={({ props }) => ({ durationInFrames: csTotalFrames(props.video) })}
    />
  </>
);

registerRoot(Root);
