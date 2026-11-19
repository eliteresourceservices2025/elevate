import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createEmployeeAccount, hydrated, signInEnrollingMfa } from "./helpers";

// REAL media through Cloudflare (no fake layer). Runs only when the Cloudflare settings are in the environment of BOTH the dev server and
// this test run, and the dev server was started without CALLS_FAKE. Chrome's fake camera and microphone supply the media, so the test
// proves pictures and sound actually travel through Cloudflare's SFU and arrive, not just that our screens work.

test.skip(!process.env.CLOUDFLARE_REALTIME_APP_ID, "Needs the real Cloudflare settings (see docs/modules/messages.md, Calls).");

/** A trace of what each browser's media connections do (for diagnosing a failure; nothing sensitive: names and states only). */
async function instrument(context: BrowserContext) {
    await context.addInitScript(() => {
      const w = window as unknown as { __rtc: string[] };
      w.__rtc = [];
      const log = (m: string) => w.__rtc.push(`${Math.round(performance.now())}ms ${m}`);
      const proto = RTCPeerConnection.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      for (const name of ["createOffer", "createAnswer", "setLocalDescription", "setRemoteDescription"]) {
        const original = proto[name];
        proto[name] = function (this: RTCPeerConnection, ...args: unknown[]) {
          log(`${name} start`);
          return original.apply(this, args).then(
            (v) => (log(`${name} ok`), v),
            (e: Error) => (log(`${name} FAILED ${e?.message?.slice(0, 120)}`), Promise.reject(e)),
          );
        };
      }
      const Original = window.RTCPeerConnection;
      const w2 = window as unknown as { __pcs: RTCPeerConnection[] };
      w2.__pcs = [];
      // Who stops a camera or microphone track (the top of the call stack only).
      const originalStop = MediaStreamTrack.prototype.stop;
      MediaStreamTrack.prototype.stop = function (this: MediaStreamTrack) {
        log(`track.stop ${this.kind} from: ${(new Error().stack ?? "").split("\n").slice(2, 5).map((l) => l.trim().replace(/\(.*\//, "(").slice(0, 90)).join(" <- ")}`);
        return originalStop.call(this);
      };
      const originalGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
        const s = await originalGum(c);
        for (const t of s.getTracks()) t.addEventListener("ended", () => log(`${t.kind} track ENDED by the browser`));
        log(`getUserMedia ok: ${s.getTracks().map((t) => t.kind).join(",")}`);
        return s;
      };
      window.RTCPeerConnection = function (this: RTCPeerConnection, ...args: ConstructorParameters<typeof RTCPeerConnection>) {
        const pc = new Original(...args);
        w2.__pcs.push(pc);
        pc.addEventListener("connectionstatechange", () => log(`pc ${pc.connectionState}`));
        pc.addEventListener("iceconnectionstatechange", () => log(`ice ${pc.iceConnectionState}`));
        return pc;
      } as unknown as typeof RTCPeerConnection;
      window.RTCPeerConnection.prototype = Original.prototype;
    });
}

async function startDirect(page: Page, otherLastName: string, otherFullName: string) {
  await page.goto("/messages");
  await (await hydrated(page.getByRole("button", { name: "New message" }))).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Find people").fill(otherLastName);
  await dialog.getByRole("button", { name: new RegExp(otherFullName) }).click();
  await dialog.getByRole("button", { name: "Open chat" }).click();
  await expect(page.getByRole("heading", { level: 2, name: otherFullName })).toBeVisible({ timeout: 45_000 });
}

/** The first picture on the page that is not mine: its size and whether time moves (real frames are arriving). */
async function otherPicture(page: Page) {
  return page.evaluate(async () => {
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-testid="call-tile"]')].filter((t) => !t.textContent?.includes("You"));
    const video = tiles.flatMap((t) => [...t.querySelectorAll("video")]).find((v) => v.srcObject && (v.srcObject as MediaStream).getVideoTracks().length > 0);
    if (!video) return { found: false, width: 0, advancing: false };
    const first = video.currentTime;
    await new Promise((r) => setTimeout(r, 1500));
    return { found: true, width: video.videoWidth, advancing: video.currentTime > first };
  });
}

/** The loudest the other people's voices got over a few seconds (0 = silence). Chrome's fake microphone beeps. */
async function otherVoiceLevel(page: Page, seconds = 5) {
  return page.evaluate(async (secs) => {
    const audios = [...document.querySelectorAll<HTMLAudioElement>("audio")].filter((a) => a.srcObject && (a.srcObject as MediaStream).getAudioTracks().length > 0);
    if (audios.length === 0) return -1;
    const ctx = new AudioContext();
    const analysers = audios.map((a) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(a.srcObject as MediaStream).connect(analyser);
      return analyser;
    });
    const buffer = new Uint8Array(1024);
    let max = 0;
    const end = Date.now() + secs * 1000;
    while (Date.now() < end) {
      for (const analyser of analysers) {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) sum += ((v - 128) / 128) ** 2;
        max = Math.max(max, Math.sqrt(sum / buffer.length));
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    await ctx.close();
    return max;
  }, seconds);
}

test("real media through Cloudflare: two people see and hear each other, and a shared screen arrives", async ({ browser }) => {
  test.setTimeout(420_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Rea${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Rea${stamp}b`);
  // Each person gets their OWN Chrome process (like two real computers): two windows of one Chrome share one fake camera and the second
  // one to open it makes Chrome end the first one's track.
  const browserB = await chromium.launch({ channel: "chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-gpu", "--auto-select-desktop-capture-source=Entire screen", "--autoplay-policy=no-user-gesture-required"] });
  const contextA = await browser.newContext({ permissions: ["microphone", "camera"] });
  const contextB = await browserB.newContext({ permissions: ["microphone", "camera"] });
  // A trace of what each browser's media connections do (for diagnosing a failure; nothing sensitive: names and states only).
  for (const context of [contextA, contextB]) await instrument(context);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const seen: string[] = [];
  for (const [name, page] of [["A", pageA], ["B", pageB]] as const) {
    page.on("console", (m) => m.type() === "error" && seen.push(`${name} console: ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => seen.push(`${name} error: ${e.message.slice(0, 160)}`));
  }
  test.info().annotations.push({ type: "browser errors", description: "printed below on failure" });
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);

  await pageB.goto("/dashboard");
  await startDirect(pageA, `Rea${stamp}b`, `Bea Rea${stamp}b`);
  await pageA.getByRole("button", { name: "Start a call" }).click();
  await pageA.waitForURL(/\/messages\/call\//, { timeout: 30_000 });
  await expect(pageA.getByText("Waiting for others to join.")).toBeVisible({ timeout: 45_000 });
  await pageB.getByRole("alertdialog", { name: "Incoming call" }).getByRole("button", { name: "Join" }).click();
  await expect(pageB.getByRole("list", { name: "People in the call" }).getByTestId("call-tile")).toHaveCount(2, { timeout: 45_000 });

  // Both turn their camera on (their microphone is on from joining).
  await pageA.getByRole("button", { name: "Turn camera on" }).click();
  await pageB.getByRole("button", { name: "Turn camera on" }).click();
  const started = Date.now();
  const trace = async (p: Page) => (await p.evaluate(() => (window as unknown as { __rtc: string[] }).__rtc).catch(() => ["(no trace)"])).slice(-14).join("; ");
  await expect(pageA.getByRole("button", { name: "Turn camera off" })).toBeVisible({ timeout: 90_000 });
  await expect(pageB.getByRole("button", { name: "Turn camera off" }), `${seen.join(" | ")}\nA: ${await trace(pageA)}\nB: ${await trace(pageB)}`).toBeVisible({ timeout: 45_000 });
  process.stdout.write(`cameras on after ${Date.now() - started} ms
`);

  // Pictures: real frames from the other person arrive, both ways.
  await expect.poll(async () => (await otherPicture(pageA)).width, { timeout: 60_000, intervals: [2_000] }).toBeGreaterThan(0);
  await expect.poll(async () => (await otherPicture(pageB)).width, { timeout: 60_000, intervals: [2_000] }).toBeGreaterThan(0);
  expect((await otherPicture(pageA)).advancing).toBe(true);
  expect((await otherPicture(pageB)).advancing).toBe(true);

  // Sound: the other person's (fake) microphone is audible, both ways.
  expect(await otherVoiceLevel(pageA)).toBeGreaterThan(0.005);
  expect(await otherVoiceLevel(pageB)).toBeGreaterThan(0.005);

  // A shared screen arrives (Chrome picks the screen by itself in this test run).
  await pageA.getByRole("button", { name: "Share your screen" }).click();
  await expect(pageB.getByTestId("screen-share")).toBeVisible({ timeout: 60_000 });
  await pageA.getByRole("button", { name: "Stop sharing your screen" }).click();
  await expect(pageB.getByTestId("screen-share")).toHaveCount(0, { timeout: 30_000 });

  // Leaving works and the call ends.
  await pageB.getByRole("button", { name: "Leave call" }).first().click();
  await pageA.getByRole("button", { name: "Leave call" }).first().click();
  await pageA.waitForURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  await expect(pageA.getByRole("log").getByText(/Call ended after \d+ min/)).toBeVisible({ timeout: 30_000 });
});

// A group call on the real SFU with several people, each in their OWN Chrome process (like separate computers). Everyone turns their camera on;
// everyone should receive real pictures from the others (up to a page of tiles) and hear them. Set CALLS_SCALE_PEOPLE to try other sizes
// (this machine is one computer, so numbers above 6 or 8 only measure this computer, not Cloudflare).
test("real media through Cloudflare: a group call where everyone sees and hears everyone", async ({ browser }) => {
  const people = Number(process.env.CALLS_SCALE_PEOPLE ?? 5);
  test.setTimeout(900_000);
  const stamp = Date.now();
  const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"];
  const hr = await (await import("./helpers")).createHrAccount();
  const members = await Promise.all(Array.from({ length: people - 1 }, (_, i) => createEmployeeAccount(`Mem${i}`, `Scl${stamp}x`)));
  const browsers = [browser, ...(await Promise.all(members.map(() => chromium.launch({ channel: "chrome", args }))))];
  const pages: Page[] = [];
  for (const b of browsers) {
    const context = await b.newContext({ permissions: ["microphone", "camera"] });
    await instrument(context);
    pages.push(await context.newPage());
  }
  const [pageHr, ...memberPages] = pages;
  await signInEnrollingMfa(pageHr, hr);
  for (let i = 0; i < memberPages.length; i++) {
    await signInEnrollingMfa(memberPages[i], members[i]);
    await memberPages[i].goto("/dashboard");
  }

  // HR makes a group of everyone and starts the call.
  const title = `Scale ${stamp}`;
  await pageHr.goto("/messages");
  await (await hydrated(pageHr.getByRole("button", { name: "New message" }))).click();
  const dialog = pageHr.getByRole("dialog");
  await dialog.getByRole("button", { name: "Group" }).click();
  await dialog.getByLabel("Group name").fill(title);
  await dialog.getByLabel("Find people").fill(`Scl${stamp}x`);
  await dialog.getByRole("button", { name: `Add everyone shown (${people - 1})` }).click();
  await dialog.getByRole("button", { name: "Create group" }).click();
  await expect(pageHr.getByRole("heading", { level: 2, name: title })).toBeVisible({ timeout: 45_000 });
  await pageHr.getByRole("button", { name: "Start a call" }).click();
  await pageHr.waitForURL(/\/messages\/call\//, { timeout: 30_000 });
  await expect(pageHr.getByText("Waiting for others to join.")).toBeVisible({ timeout: 60_000 });

  // Everyone answers the ring.
  const joinedAt = Date.now();
  await Promise.all(memberPages.map((p) => p.getByRole("alertdialog", { name: "Incoming call" }).getByRole("button", { name: "Join" }).click({ timeout: 60_000 })));
  for (const p of pages) await expect(p.getByRole("list", { name: "People in the call" }).getByTestId("call-tile")).toHaveCount(people, { timeout: 90_000 });
  process.stdout.write(`SCALE all ${people} joined after ${Date.now() - joinedAt} ms\n`);

  // Everyone's camera on.
  const cameraOn = Date.now();
  await Promise.all(pages.map((p) => p.getByRole("button", { name: "Turn camera on" }).click()));
  for (const p of pages) await expect(p.getByRole("button", { name: "Turn camera off" })).toBeVisible({ timeout: 120_000 });
  process.stdout.write(`SCALE all cameras on after ${Date.now() - cameraOn} ms\n`);

  // Each person receives a real picture (frames advancing) from every other person, and can hear them.
  const pictures = async (p: Page) =>
    p.evaluate(async () => {
      const tiles = [...document.querySelectorAll<HTMLElement>('[data-testid="call-tile"]')].filter((t) => !t.textContent?.includes("You"));
      const videos = tiles.flatMap((t) => [...t.querySelectorAll("video")]).filter((v) => v.srcObject && (v.srcObject as MediaStream).getVideoTracks().length > 0);
      const before = videos.map((v) => v.currentTime);
      await new Promise((r) => setTimeout(r, 1500));
      return { others: tiles.length, withPicture: videos.length, moving: videos.filter((v, i) => v.currentTime > before[i]).length };
    });
  const started = Date.now();
  for (const [i, p] of pages.entries()) {
    try {
      await expect.poll(async () => (await pictures(p)).withPicture, { timeout: 120_000, intervals: [3_000], message: `person ${i} pictures` }).toBe(people - 1);
    } catch (error) {
      const lines = await p.evaluate(() => (window as unknown as { __rtc: string[] }).__rtc).catch(() => ["(no trace)"]);
      process.stdout.write(`SCALE FAILED person ${i}: ${JSON.stringify(await pictures(p))}\nSCALE failures: ${lines.filter((l) => /FAILED|failed|disconnected/.test(l)).slice(0, 8).join(" ;; ")}\nSCALE last: ${lines.slice(-14).join(" ;; ")}\n`);
      throw error;
    }
  }
  process.stdout.write(`SCALE every person has every picture after ${Date.now() - started} ms\n`);
  for (const [i, p] of pages.entries()) {
    const result = await pictures(p);
    process.stdout.write(`SCALE person ${i}: ${result.withPicture}/${people - 1} pictures, ${result.moving} moving\n`);
    expect(result.moving).toBe(people - 1);
  }
  for (const p of pages) expect(await otherVoiceLevel(p, 4)).toBeGreaterThan(0.005);
  process.stdout.write(`SCALE everyone can hear the others\n`);

  for (const p of pages) await p.getByRole("button", { name: "Leave call" }).first().click().catch(() => {});
  for (const b of browsers.slice(1)) await b.close().catch(() => {});
});

test("real media through Cloudflare: switching the microphone mid-call keeps the sound flowing", async ({ browser }) => {
  test.setTimeout(420_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Rdv${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Rdv${stamp}b`);
  const browserB = await chromium.launch({ channel: "chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"] });
  const contextA = await browser.newContext({ permissions: ["microphone", "camera"] });
  const contextB = await browserB.newContext({ permissions: ["microphone", "camera"] });
  for (const context of [contextA, contextB]) await instrument(context);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await pageB.goto("/dashboard");
  await startDirect(pageA, `Rdv${stamp}b`, `Bea Rdv${stamp}b`);
  await pageA.getByRole("button", { name: "Start a call" }).click();
  await pageA.waitForURL(/\/messages\/call\//, { timeout: 30_000 });
  await expect(pageA.getByText("Waiting for others to join.")).toBeVisible({ timeout: 45_000 });
  await pageB.getByRole("alertdialog", { name: "Incoming call" }).getByRole("button", { name: "Join" }).click();
  await expect(pageB.getByRole("list", { name: "People in the call" }).getByTestId("call-tile")).toHaveCount(2, { timeout: 45_000 });

  // Before: Bea hears Ana's microphone.
  await expect.poll(() => otherVoiceLevel(pageB, 3), { timeout: 90_000, intervals: [1_000] }).toBeGreaterThan(0.005);

  // Ana changes her microphone to another one (Chrome's fake devices come in several), without leaving the call.
  await pageA.getByRole("button", { name: "More call options" }).click();
  await pageA.getByRole("menuitem", { name: "Devices" }).click();
  const mic = pageA.getByRole("dialog", { name: "Devices" }).getByLabel("Microphone", { exact: true });
  const options = await mic.locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
  expect(options.length).toBeGreaterThan(1);
  const senderTrackBefore = await pageA.evaluate(() => {
    const pcs = (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? [];
    return pcs.flatMap((pc) => pc.getSenders()).find((s) => s.track?.kind === "audio")?.track?.label ?? "";
  });
  await mic.selectOption(options[1]);
  await pageA.keyboard.press("Escape");

  // After: the sender has a different microphone, nothing renegotiated, and Bea still hears Ana.
  await expect
    .poll(async () => pageA.evaluate(() => {
      const pcs = (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? [];
      return pcs.flatMap((pc) => pc.getSenders()).find((s) => s.track?.kind === "audio")?.track?.label ?? "";
    }), { timeout: 20_000 })
    .not.toBe(senderTrackBefore);
  await expect(pageA.getByRole("button", { name: "Mute microphone" })).toBeVisible();
  await expect.poll(() => otherVoiceLevel(pageB, 4), { timeout: 60_000, intervals: [1_000] }).toBeGreaterThan(0.005);

  await pageB.getByRole("button", { name: "Leave call" }).first().click();
  await pageA.getByRole("button", { name: "Leave call" }).first().click();
  await browserB.close();
});
