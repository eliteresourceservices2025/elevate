import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, hydrated, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. HR posts an announcement and publishes a policy;
// an employee sees the banner, acknowledges both, and HR sees who acknowledged.
test("HR posts, an employee acknowledges, and HR sees the status", async ({ browser }) => {
  test.setTimeout(180_000); // three sign-ins and many page loads: close to the 90 second default under parallel load
  const stamp = Date.now();
  const hr = await createHrAccount();
  const employee = await createEmployeeAccount("Eli", `Ack${stamp}`);

  const hrPage = await (await browser.newContext()).newPage();
  const empPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await signInEnrollingMfa(empPage, employee);

  // --- HR posts an announcement that needs acknowledgment. Markup is shown as plain text. ---
  const title = `Office closed ${stamp}`;
  await hrPage.goto("/announcements/new");
  await waitForHydration(hrPage, "#an-title");
  await hrPage.getByLabel("Title").fill(title);
  await hrPage.getByLabel("Message").fill("We are closed on **Friday**.\n\n<script>alert('x')</script>\n\n[Bad link](javascript:alert(1))");
  // The preview shows it as readers will see it (same renderer: markup stays text, bad links are not links), and Write brings the text back.
  await hrPage.getByRole("button", { name: "Preview" }).click();
  const previewBox = hrPage.getByRole("article", { name: "Preview of message" });
  await expect(previewBox.locator("strong", { hasText: "Friday" })).toBeVisible();
  await expect(previewBox.getByText("<script>alert('x')</script>")).toBeVisible();
  await expect(previewBox.locator("a[href^='javascript']")).toHaveCount(0);
  await expect(hrPage.getByText("This is how it will look when published.")).toBeVisible();
  await hrPage.getByRole("button", { name: "Write" }).click();
  await expect(hrPage.getByLabel("Message")).toHaveValue(/We are closed on/);
  await hrPage.getByLabel("Require acknowledgment").check();
  await hrPage.getByRole("button", { name: "Post announcement" }).click();
  await hrPage.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  const announcementUrl = hrPage.url();

  await expect(hrPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(hrPage.getByText("<script>alert('x')</script>")).toBeVisible(); // literal text, not executed
  await expect(hrPage.locator("article strong", { hasText: "Friday" })).toBeVisible();
  await expect(hrPage.locator("article a[href^='javascript']")).toHaveCount(0);
  await expect(hrPage.getByRole("button", { name: /Send reminder/ })).toBeVisible();

  // --- The employee sees the banner and the dashboard entry, reads it, and acknowledges ---
  await empPage.goto("/dashboard");
  const banner = empPage.getByRole("region", { name: "Acknowledgments needed" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/needs? your acknowledgment/); // it lists only the first 3; the dashboard list below has them all
  await expect(empPage.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible();

  await empPage.getByRole("region", { name: "Waiting for you" }).getByRole("link", { name: title }).click();
  await empPage.waitForURL(announcementUrl);
  await (await hydrated(empPage.getByRole("button", { name: "I have read and understand" }))).click();
  await expect(empPage.getByText("Your acknowledgment is recorded.")).toBeVisible();
  await expect(empPage.getByText(/You acknowledged this on/)).toBeVisible();
  await empPage.goto("/dashboard");
  await expect(empPage.getByRole("region", { name: "Waiting for you" }).getByRole("link", { name: title })).toHaveCount(0);

  // The employee cannot see who else acknowledged
  await empPage.goto(announcementUrl);
  await expect(empPage.getByRole("region", { name: "Who has acknowledged" })).toHaveCount(0);

  // --- HR sees the employee as acknowledged ---
  await hrPage.reload();
  const status = hrPage.getByRole("region", { name: "Who has acknowledged" });
  const row = status.getByRole("row").filter({ hasText: `Ack${stamp}` });
  await expect(row).toBeVisible();
  await expect(row.getByText(/Acknowledged/)).toBeVisible();
  await expect(row.getByText("Not acknowledged")).toHaveCount(0);

  // --- HR publishes a policy; the employee is asked to acknowledge it ---
  const policyTitle = `Conduct ${stamp}`;
  await hrPage.goto("/announcements?tab=policies");
  await waitForHydration(hrPage, "#np-title");
  await hrPage.getByLabel("Policy title").fill(policyTitle);
  await hrPage.getByLabel("Text", { exact: true }).fill("# Be kind\n\n- Respect each other");
  await hrPage.getByRole("button", { name: "Create draft" }).click();
  await hrPage.waitForURL(/\/announcements\/policies\/[0-9a-f-]{36}$/);
  const policyUrl = hrPage.url();
  hrPage.once("dialog", (d) => void d.accept());
  await (await hydrated(hrPage.getByRole("button", { name: "Publish version 1" }))).click();
  await expect(hrPage.getByText("Version 1 published.")).toBeVisible();

  await empPage.goto(policyUrl);
  await expect(empPage.getByRole("heading", { level: 2, name: "Be kind" })).toBeVisible();
  await (await hydrated(empPage.getByRole("button", { name: "I have read and understand" }))).click();
  await expect(empPage.getByText(/You acknowledged version 1 on/)).toBeVisible();

  await hrPage.reload();
  await expect(hrPage.getByRole("region", { name: "Who has acknowledged" }).getByRole("row").filter({ hasText: `Ack${stamp}` }).getByText(/Acknowledged/)).toBeVisible();
});

// A picture inside the text and a PDF to download; the employee sees both, and the picture is a stored file, never an outside address.
test("HR adds a picture and a PDF to an announcement and an employee sees them", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 45_000 };
  const stamp = Date.now();
  const hr = await createHrAccount();
  const employee = await createEmployeeAccount("Pia", `Files${stamp}`);

  // A plain 200 x 120 PNG the browser re-encodes to a JPEG
  const { deflateSync } = await import("node:zlib");
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const w = 200;
  const h = 120;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [0x6c, 0x1a, 0xba]).flat())]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);

  const hrPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await hrPage.goto("/announcements/new");
  await waitForHydration(hrPage, "#an-title");
  const title = `Team photo day ${stamp}`;
  await hrPage.getByLabel("Title").fill(title);
  await hrPage.getByLabel("Message").fill("Here is the schedule for the photo day.");

  // A picture: add, describe, insert into the text
  await hrPage.getByLabel("Choose a picture").setInputFiles({ name: "team.png", mimeType: "image/png", buffer: png });
  await expect(hrPage.getByText("team.jpg", { exact: true })).toBeVisible(slow);
  await hrPage.getByLabel("Describe team.jpg").fill("The whole team outside the office");
  await hrPage.getByRole("button", { name: "Insert in text" }).click();
  await expect(hrPage.getByLabel("Message")).toHaveValue(/!\[The whole team outside the office\]\(file:[0-9a-f-]{36}\)/);

  // A PDF to download
  await hrPage.getByLabel("Choose a PDF or Word file").setInputFiles({ name: "Schedule.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% e2e schedule\n1 0 obj\n<<>>\nendobj\n") });
  await expect(hrPage.getByText("Schedule.pdf", { exact: true })).toBeVisible(slow);

  await hrPage.getByRole("button", { name: "Post announcement" }).click();
  await hrPage.waitForURL(/\/announcements\/[0-9a-f-]{36}$/, slow);
  const url = hrPage.url();
  await expect(hrPage.getByAltText("The whole team outside the office")).toBeVisible(slow);

  // The employee sees the picture in the text and the PDF as a download
  const empPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(empPage, employee);
  await empPage.goto(url);
  const picture = empPage.getByAltText("The whole team outside the office");
  await expect(picture).toBeVisible(slow);
  await expect(picture).toHaveAttribute("src", /^\/api\/content\/files\/[0-9a-f-]{36}$/);
  const link = empPage.getByRole("link", { name: /Schedule\.pdf/ });
  await expect(link).toBeVisible();
  const served = await empPage.request.get((await link.getAttribute("href"))!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-disposition"]).toContain("attachment");

  // Not signed in: nothing is served
  const anon = await (await browser.newContext()).newPage();
  const picturePath = (await picture.getAttribute("src"))!;
  const denied = await anon.request.get(new URL(picturePath, url).toString(), { maxRedirects: 0 });
  expect([307, 308, 401, 403, 404]).toContain(denied.status());
});
