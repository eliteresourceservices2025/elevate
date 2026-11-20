import { useCallback, useEffect, useState } from "react";
import { status as loadStatus, subscribe, type Notice, type StatusView } from "./api";
import { Captured } from "./screens/Captured";
import { SignIn } from "./screens/SignIn";
import { Status } from "./screens/Status";

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

  if (!status) return <main className="app"><p className="muted">Loading…</p></main>;

  return (
    <main className="app">
      <header className="between">
        <h1>ELEVATE Tracker App</h1>
        <span className="muted">Version {status.version}</span>
      </header>

      {!status.signedIn ? (
        <SignIn onDone={reload} />
      ) : status.updateRequired ? (
        <section className="card stack" role="alert">
          <h2>Update needed</h2>
          <p>This version is too old to keep recording. Version {status.updateRequired} or newer is needed. Your hours are not affected.</p>
        </section>
      ) : (
        <>
          <nav className="tabs" aria-label="Sections">
            <button className={tab === "status" ? "active" : ""} aria-current={tab === "status"} onClick={() => setTab("status")}>Clock</button>
            <button className={tab === "captured" ? "active" : ""} aria-current={tab === "captured"} onClick={() => setTab("captured")}>What was captured</button>
          </nav>
          {tab === "status" ? <Status status={status} notice={notice} onNotice={setNotice} onChanged={reload} /> : <Captured refreshKey={refreshKey} onDisconnected={reload} />}
        </>
      )}
    </main>
  );
}
