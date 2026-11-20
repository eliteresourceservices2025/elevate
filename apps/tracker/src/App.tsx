import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export function App() {
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    invoke<string>("app_version")
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);
  return (
    <main style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 24, color: "#1d1b26" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>ELEVATE Tracker App</h1>
      <p style={{ color: "#5b5868" }}>{version ? `Version ${version}` : ""}</p>
    </main>
  );
}
