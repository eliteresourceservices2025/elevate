import { useState } from "react";
import { checkForUpdates } from "../api";

/** This version is too old: nothing is sent until it is updated. The update downloads and installs by itself; the button asks it to look now. */
export function RequiredUpdate({ minVersion, readyVersion, autoUpdate }: { minVersion: string; readyVersion: string | null; autoUpdate: boolean }) {
  const [asked, setAsked] = useState(false);
  return (
    <section className="card stack" role="alert">
      <h2>Update needed</h2>
      <p>This version is too old to keep recording. Version {minVersion} or newer is needed, and nothing is recorded or sent until the app is updated. Your hours in ELEVATE are not affected, and the clock buttons below still work.</p>
      {!autoUpdate ? <p>Download the newest version from the ELEVATE Tracker App page in ELEVATE, then install it over this one.</p> : null}
      {readyVersion ? <p className="notice ok">Version {readyVersion} is downloaded and installing now.</p> : null}
      {autoUpdate ? (
      <button
        className="primary"
        disabled={asked}
        onClick={async () => {
          setAsked(true);
          await checkForUpdates();
          window.setTimeout(() => setAsked(false), 10_000);
        }}
      >
        {asked ? "Looking for the update…" : "Update now"}
      </button>
      ) : null}
    </section>
  );
}
