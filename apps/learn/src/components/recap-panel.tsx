// The optional recap at the top of a module: a short motion-graphics video with a voice-over and quiet music, whose on-screen
// words are the captions, with the same words as a transcript. Reading the module stays the required part, so nothing here counts toward progress. The file is
// served from this app's own origin (the content security policy allows media from `self` only), and is not fetched until played.

import { ProtectedVideo } from "./protected-video";

export type RecapView = { file: string; seconds: number; transcript: string[]; captions?: string | null };

export function RecapPanel({ recap, title }: { recap: RecapView; title: string }) {
  return (
    <details className="recap">
      <summary>
        Optional: watch a {recap.seconds}-second recap <span className="muted">(voice-over{recap.captions ? ", with optional subtitles" : ", with captions on screen"})</span>
      </summary>
      <ProtectedVideo className="recap-video" src={recap.file} captions={recap.captions} label={`Recap of the module: ${title}`} />
      <details className="recap-transcript">
        <summary>Read the recap as text</summary>
        <ul>
          {recap.transcript.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </details>
      <p className="muted">The recap is a summary only. The module below is the required part.</p>
    </details>
  );
}
