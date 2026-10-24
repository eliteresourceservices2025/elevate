"use client";

// The optional videos of a course and its modules: short motion-graphics videos with a voice-over and quiet music, whose on-screen words are
// the captions, with the same words as a transcript. A video opens in a pop-up (a native dialog: Esc closes it, focus stays inside, the page
// behind does not scroll) so it takes no room in the lesson. Reading the module stays the required part, so nothing here counts toward
// progress. The file is served from this app's own origin (the content security policy allows media from `self` only), is not fetched until
// played, and is paused and rewound when the pop-up closes.

import { useId, useRef } from "react";
import { ProtectedVideo } from "./protected-video";

export type RecapView = { file: string; seconds: number; transcript: string[]; captions?: string | null;
  /** A title for a video that is one of several (a lesson video); a module recap has none. */
  label?: string;
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function PlayIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" focusable="false">
      <path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z" />
    </svg>
  );
}

/** A button that opens one video in a pop-up. `children` is the button's words; the pop-up carries the title, the player and the transcript. */
export function VideoButton({ recap, title, children, className }: { recap: RecapView; title: string; children?: React.ReactNode; className?: string }) {
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLDivElement>(null);
  const heading = recap.label ? `Optional video: ${recap.label}` : "Optional recap of this module";

  function open() {
    dialog.current?.showModal();
    // started by the person's own click, so playing is allowed; if the browser refuses, the controls are right there
    video.current?.querySelector("video")?.play().catch(() => {});
  }
  function stop() {
    const v = video.current?.querySelector("video");
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  }

  return (
    <>
      <button type="button" className={className ?? "video-btn"} onClick={open}>
        <PlayIcon />
        <span>{children ?? <>Watch the {recap.seconds}-second recap</>}</span>
      </button>
      <dialog
        ref={dialog}
        className="video-modal"
        aria-labelledby={headingId}
        onClose={stop}
        onClick={(e) => {
          // the dialog has no padding of its own (the body does), so a click on the dialog element itself is a click on the dimmed area
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="video-modal-body">
        <div className="video-modal-head">
          <h2 id={headingId}>
            {heading} <span className="muted small">({clock(recap.seconds)}, voice-over{recap.captions ? ", with optional subtitles" : ", with captions on screen"})</span>
          </h2>
          <button type="button" className="video-modal-close" onClick={() => dialog.current?.close()} aria-label="Close the video">
            Close
          </button>
        </div>
        <div ref={video}>
          <ProtectedVideo className="recap-video" src={recap.file} captions={recap.captions} label={recap.label ? `Video: ${recap.label}` : `Recap of the module: ${title}`} />
        </div>
        <details className="recap-transcript">
          <summary>{recap.label ? "Read the video as text" : "Read the recap as text"}</summary>
          <ul>
            {recap.transcript.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
        <p className="muted small">{recap.label ? "This video is optional. The module is the required part." : "The recap is a summary only. The module is the required part."}</p>
        </div>
      </dialog>
    </>
  );
}

/** One or several videos of a module as a single slim row of buttons, so the lesson keeps its room. */
export function VideoGroup({ videos, title, heading }: { videos: RecapView[]; title: string; heading?: string }) {
  return (
    <div className="video-bar" role="group" aria-label={heading ?? "Optional videos for this module"}>
      <span className="muted small">{heading ?? (videos.length === 1 ? "Optional video:" : "Optional videos:")}</span>
      {videos.map((v) => (
        <VideoButton key={v.file} recap={v} title={title}>
          {v.label ? <>{v.label} <span className="muted">({clock(v.seconds)})</span></> : undefined}
        </VideoButton>
      ))}
    </div>
  );
}

/** A module's recap (or any single video) as one button. */
export function RecapPanel({ recap, title }: { recap: RecapView; title: string }) {
  return (
    <div className="video-bar">
      <VideoButton recap={recap} title={title}>
        {recap.label ? <>{recap.label} <span className="muted">({clock(recap.seconds)})</span></> : undefined}
      </VideoButton>
    </div>
  );
}
