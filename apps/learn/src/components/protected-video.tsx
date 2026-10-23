"use client";

// A course video with no download button, no "save video as" menu and no picture-in-picture or cast button. This only removes the
// easy ways to keep a copy: anyone who can play a video can still record the screen, so it is a deterrent, not a lock.
export function ProtectedVideo({ src, label, className, captions }: { src: string; label: string; className?: string; captions?: string | null }) {
  return (
    <video
      className={className}
      controls
      controlsList="nodownload noremoteplayback"
      disablePictureInPicture
      disableRemotePlayback
      preload="none"
      playsInline
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
    >
      <source src={src} type="video/mp4" />
      {captions ? <track kind="subtitles" src={captions} srcLang="en" label="English subtitles" /> : null}
      Your browser cannot play this video. The transcript has the same words.
    </video>
  );
}
