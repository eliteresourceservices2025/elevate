// Stands in for the ELEVATE Tracker App while the real app does not exist yet (and afterwards, to test the server).
// It talks to the HTTP API only, exactly as the app will; it imports nothing from the app's code.
//
//   pnpm tracker:sim --code ABCD2345                       enroll a fake computer with a code from the app, then report
//   pnpm tracker:sim --token <device token>                reuse a device that is already enrolled
//   options: --base http://localhost:3000   --minutes 30   --interval 30   (seconds between reports)
//
// It only records while the server says the person is working (clocked in, not on a break), like the real app. FAKE DATA ONLY:
// the app names are invented and the "screenshot" is a tiny placeholder file, not a picture of anything.

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");

const base = (args.get("base") ?? "http://localhost:3000").replace(/\/$/, "");
const minutes = Number(args.get("minutes") ?? "30");
const interval = Number(args.get("interval") ?? "30") * 1000;
let token = args.get("token") ?? "";
const code = args.get("code") ?? "";

const APPS = ["Chrome", "Excel", "Teams", "Outlook", "Word"];
const MIN = 60_000;
const log = (message: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}/api/tracker/${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

/** A placeholder file with a JPEG signature: enough for the server's type check, and obviously not a real picture. */
function placeholderJpeg(): Uint8Array {
  const bytes = new Uint8Array(2048);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  return bytes;
}

async function uploadShot(takenAt: string) {
  const asked = await api("shots/request", { body: { takenAt } });
  if (asked.status !== 200) return log(`screenshot not allowed: ${String(asked.json.error)}`);
  const url = asked.json.uploadUrl as string | null;
  if (!url) return log("no upload address (the server has no storage URL configured)");
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", new Blob([placeholderJpeg() as BlobPart], { type: "image/jpeg" }));
  const put = await fetch(url, { method: "PUT", body: form });
  if (!put.ok) return log(`upload failed (${put.status})`);
  const done = await api("shots/finalize", { body: { shotId: asked.json.shotId } });
  log(done.status === 200 ? "screenshot stored" : `screenshot refused: ${String(done.json.error)}`);
}

async function main() {
  if (!token) {
    if (!code) throw new Error("Give --code (from the ELEVATE Tracker App page) or --token.");
    const enrolled = await api("enroll", { body: { code, name: "Simulated computer", os: "windows", appVersion: "0.0.0-sim" } });
    if (enrolled.status !== 200) throw new Error(`Enrollment failed: ${String(enrolled.json.error)}`);
    token = enrolled.json.token as string;
    log("enrolled. Keep this token to reuse the device (do not commit it):");
    console.log(token);
  }

  const stopAt = Date.now() + minutes * MIN;
  let from = Date.now();
  let lastShotWindow = -1;
  while (Date.now() < stopAt) {
    const state = await api("clock-state");
    if (state.status === 401) throw new Error("The server does not know this device (revoked or wrong token).");
    const working = state.json.state === "working";
    log(`clock state: ${String(state.json.state)}${state.json.policy ? "" : " (monitoring policy not published)"}`);
    const now = Date.now();
    if (working && now - from >= 5_000) {
      const segments: { start: string; end: string; app: string; state: "active" | "idle" }[] = [];
      let cursor = from;
      while (cursor < now) {
        const end = Math.min(now, cursor + 2 * MIN);
        const idle = Math.random() < 0.15;
        segments.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString(), app: APPS[Math.floor(Math.random() * APPS.length)], state: idle ? "idle" : "active" });
        cursor = end;
      }
      const sent = await api("segments", { body: { segments, appVersion: "0.0.0-sim", permissionsOk: true, queueSize: 0 } });
      log(`sent ${segments.length} segments -> ${sent.status} ${JSON.stringify(sent.json)}`);
      const window = Math.floor(now / (10 * MIN));
      if (window !== lastShotWindow) {
        lastShotWindow = window;
        await uploadShot(new Date(now - 1000).toISOString());
      }
    }
    from = now;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  log("done");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
