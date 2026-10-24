import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied and `pnpm storage:setup` run (the announcement-videos bucket).
// HR attaches an MP4 to an announcement (the browser sends it straight to storage); an employee plays it and can seek (Range works).
const VIDEO = join(process.cwd(), "content", "help", "videos", "add-or-edit-a-person.mp4"); // an ordinary small MP4 already in the repo

test("HR adds a video to an announcement and an employee plays and seeks it", async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const hr = await createHrAccount();
  const employee = await createEmployeeAccount("Vic", `Video${stamp}`);
  const hrPage = await (await browser.newContext()).newPage();
  const empPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await signInEnrollingMfa(empPage, employee);

  const title = `Welcome video ${stamp}`;
  await hrPage.goto("/announcements/new");
  await waitForHydration(hrPage, "#an-title");
  await hrPage.getByLabel("Title").fill(title);
  await hrPage.getByLabel("Message").fill("Please watch this short video.");

  // A file that is not a video is refused before anything is stored
  await hrPage.getByLabel("Choose a video").setInputFiles({ name: "notes.mp4", mimeType: "video/mp4", buffer: Buffer.from("%PDF-1.4 not a video at all") });
  await expect(hrPage.getByText(/not an MP4 or WebM video/)).toBeVisible();

  await hrPage.getByLabel("Choose a video").setInputFiles(VIDEO);
  await expect(hrPage.getByText("Video, shown above the text")).toBeVisible({ timeout: 60_000 });
  await expect(hrPage.getByRole("button", { name: "Add a video" })).toBeDisabled(); // one video per announcement
  await hrPage.getByRole("button", { name: "Post announcement" }).click();
  await hrPage.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  const url = hrPage.url();

  await empPage.goto(url);
  const video = empPage.locator("video");
  await expect(video).toBeVisible();
  const src = await video.getAttribute("src");
  expect(src).toMatch(/^\/api\/content\/files\/[0-9a-f-]{36}$/);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1 && v.duration > 0)).toBe(true);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration / 2;
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime > 0.5)).toBe(true);

  // The route redirects to a signed storage link that serves byte ranges
  const ranged = await empPage.request.get(src!, { headers: { Range: "bytes=0-99" } });
  expect(ranged.status()).toBe(206);

  // Signed out, the same address is not reachable
  const anonymous = await (await browser.newContext()).request.get(new URL(src!, url).toString(), { maxRedirects: 0 });
  expect([307, 401, 403, 404]).toContain(anonymous.status());
  if (anonymous.status() === 307) expect(anonymous.headers()["location"]).toMatch(/login|sign-in/);
});
