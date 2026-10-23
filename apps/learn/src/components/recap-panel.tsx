// The optional recap at the top of a module: a short motion-graphics video with a voice-over and quiet music, whose on-screen
// words are the captions, with the same words as a transcript. Reading the module stays the required part, so nothing here counts toward progress. The file is
// served from this app's own origin (the content security policy allows media from `self` only), and is not fetched until played.

import { ProtectedVideo } from "./protected-video";

export type RecapView = { file: string; seconds: number; transcript: string[]; captions?: string | null;
  /** A title for a video that is one of several (a lesson video); a module recap has none. */
  label?: string;
};

/** Several lesson videos of one module behind one line, so the lesson keeps its room. One video is shown as it is. */
export function VideoGroup({ videos, title, heading }: { videos: RecapView[]; title: string; heading?: string }) {
  if (videos.length === 1) return <RecapPanel recap={videos[0]} title={title} />;
  return (
    <details className="recap">
      <summary>{heading ?? "Optional videos for this module"} ({videos.length})</summary>
      {videos.map((v) => (
        <RecapPanel key={v.file} recap={v} title={title} />
      ))}
    </details>
  );
}

export function RecapPanel({ recap, title }: { recap: RecapView; title: string }) {
  return (
    <details className="recap">
      <summary>
        {recap.label ? <>Optional video: {recap.label} ({recap.seconds} seconds)</> : <>Optional: watch a {recap.seconds}-second recap</>} <span className="muted">(voice-over{recap.captions ? ", with optional subtitles" : ", with captions on screen"})</span>
      </summary>
      <ProtectedVideo className="recap-video" src={recap.file} captions={recap.captions} label={recap.label ? `Video: ${recap.label}` : `Recap of the module: ${title}`} />
      <details className="recap-transcript">
        <summary>{recap.label ? "Read the video as text" : "Read the recap as text"}</summary>
        <ul>
          {recap.transcript.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </details>
      <p className="muted">{recap.label ? "This video is optional. The module below is the required part." : "The recap is a summary only. The module below is the required part."}</p>
    </details>
  );
}
