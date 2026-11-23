import { useCallback, useEffect, useState } from "react";
import { status as loadStatus, subscribe, timeOf, type Notice, type StatusView } from "./api";
import { Captured } from "./screens/Captured";
import { RequiredUpdate } from "./screens/RequiredUpdate";
import { SignIn } from "./screens/SignIn";
import { Status } from "./screens/Status";
import { WhatsNew } from "./screens/WhatsNew";

type Tab = "status" | "captured";

export function App() {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [tab, setTab] = useState<Tab>("status");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(() => {
    void loadStatus().then(setStatus);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    reload();
    let off: (() => void) | undefined;
    void subscribe(reload, setNotice).then((fn) => (off = fn));
    const timer = window.setInterval(reload, 15_000); // the app also tells us; this keeps "waiting" counts fresh
    return () => {
      off?.();
      window.clearInterval(timer);
    };
  }, [reload]);

  // A message about a click ("Clocked in.") goes away by itself after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!status) return <main className="app"><p className="muted">Loading…</p></main>;

  return (
    <main className="app">
      <header className="topbar">
        <span className="logo" aria-hidden>E</span>
        <h1>ELEVATE Tracker App</h1>
        {status.signedIn ? (
          <span className={`pill ${status.online ? "online" : "offline"}`}>
            <span className="dot" aria-hidden />
            {status.online ? "Online" : "Offline"}
          </span>
        ) : null}
      </header>

      {!status.signedIn ? (
        <SignIn onDone={reload} />
      ) : (
        <>
          {status.updateRequired ? <RequiredUpdate minVersion={status.updateRequired} readyVersion={status.updateVersion} /> : <WhatsNew />}
          {status.updateVersion ? <p className="notice info">Version {status.updateVersion} is ready. It installs when you are not working.</p> : null}
          <nav className="tabs" aria-label="Sections">
            <button className={tab === "status" ? "active" : ""} aria-current={tab === "status"} onClick={() => setTab("status")}>Clock</button>
            <button className={tab === "captured" ? "active" : ""} aria-current={tab === "captured"} onClick={() => setTab("captured")}>What was captured</button>
          </nav>
          {tab === "status" ? <Status status={status} notice={notice} onNotice={setNotice} onChanged={reload} /> : <Captured refreshKey={refreshKey} onDisconnected={reload} />}
        </>
      )}

      <footer className="footer">
        <span>
          {!status.signedIn
            ? "Not connected"
            : status.queueLen > 0
              ? `${status.queueLen} items waiting to be sent`
              : status.lastSentMs
                ? `Last sent at ${timeOf(new Date(status.lastSentMs).toISOString())}`
                : "Nothing sent yet"}
        </span>
        <span>Version {status.version}</span>
      </footer>
    </main>
  );
}
