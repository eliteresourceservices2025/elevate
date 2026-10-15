import React from "react";
import { Composition, registerRoot } from "remotion";
import { Recap, totalFrames } from "./Recap.jsx";

const Root = () => (
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
);

registerRoot(Root);
