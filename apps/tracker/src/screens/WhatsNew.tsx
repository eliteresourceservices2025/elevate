import { useEffect, useState } from "react";
import { markWhatsNewSeen, whatsNew, type ReleaseNotes } from "../api";

const GROUPS: { key: "added" | "improved" | "fixed"; label: string }[] = [
  { key: "added", label: "Added" },
  { key: "improved", label: "Improved" },
  { key: "fixed", label: "Fixed" },
];

/** Shown once after the app has been updated: what changed, in three plain lists written in ELEVATE. */
export function WhatsNew() {
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);

  useEffect(() => {
    void whatsNew().then(setNotes).catch(() => setNotes(null));
  }, []);

  if (!notes) return null;
  const any = GROUPS.some((g) => notes.notes[g.key].length > 0);
  return (
    <section className="card stack" role="dialog" aria-label={`What's new in version ${notes.version}`}>
      <h2>What&apos;s new in {notes.version}</h2>
      {!any ? <p className="muted">This version has no listed changes.</p> : null}
      {GROUPS.filter((g) => notes.notes[g.key].length > 0).map((g) => (
        <div key={g.key} className="stack">
          <h3>{g.label}</h3>
          <ul className="bullets">
            {notes.notes[g.key].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
      <button
        className="primary"
        onClick={async () => {
          await markWhatsNewSeen();
          setNotes(null);
        }}
      >
        Got it
      </button>
    </section>
  );
}
