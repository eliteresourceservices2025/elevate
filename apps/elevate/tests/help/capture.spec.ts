import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { signInEnrollingMfa } from "../e2e/helpers";
import { ensureShotAccount } from "./accounts";
import { seedDemoData, startDemoCases } from "./demo-data";
import { SHOTS, type RoleKey, type Shot } from "./shots";

// Takes the screenshots listed in shots.ts. See docs/modules/help-center.md. Local database only (the e2e helpers refuse anything else).

const ASSETS = path.join(process.cwd(), "content", "help", "assets");

// One throwaway account per role, with fake names, so every picture is taken as that role would see the screen.
const PEOPLE: Record<RoleKey, { first: string; last: string; roles: string[] }> = {
  super_admin: { first: "Ana", last: "Reyes", roles: ["super_admin"] },
  hr_admin: { first: "Maria", last: "Santos", roles: ["hr_admin"] },
  team_lead: { first: "Daniel", last: "Brooks", roles: ["team_lead"] },
  recruiter: { first: "Emily", last: "Carter", roles: ["recruiter"] },
  employee: { first: "Joy", last: "Villanueva", roles: [] },
};

/** Hides what is not part of the product screen (the dev server's badge) and draws the gold frames. */
async function dress(page: Page, highlight: Locator[]) {
  await page.addStyleTag({ content: "nextjs-portal, [data-nextjs-dev-tools-button], [data-nextjs-toast] { display: none !important; }" });
  for (const target of highlight) {
    await target.first().evaluate((el) => {
      const node = el as HTMLElement;
      node.style.outline = "4px solid #E2BE2B";
      node.style.outlineOffset = "3px";
      node.style.borderRadius = "8px";
      node.style.boxShadow = "0 0 0 8px rgba(226, 190, 43, 0.28)";
    });
  }
}

test("take the Help center screenshots", async ({ browser }) => {
  const only = (process.env.HELP_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const shots: Shot[] = only.length ? SHOTS.filter((s) => only.includes(s.article)) : SHOTS;
  if (shots.length === 0) throw new Error(`No screenshot is listed for: ${only.join(", ")}`);

  await seedDemoData();

  const contexts = new Map<RoleKey, BrowserContext>();
  const contextFor = async (role: RoleKey) => {
    let context = contexts.get(role);
    if (!context) {
      context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
      const page = await context.newPage();
      const who = PEOPLE[role];
      await signInEnrollingMfa(page, await ensureShotAccount(who.first, who.last, who.roles));
      await page.close();
      contexts.set(role, context);
    }
    return context;
  };

  // Onboarding and offboarding cases are made through the real screens as HR
  {
    const page = await (await contextFor("hr_admin")).newPage();
    await startDemoCases(page);
    await page.close();
  }

  // Where named parts of each picture are (x, y, width, height in picture pixels): the narrated videos zoom to them
  const boxFile = path.join(ASSETS, "_boxes.json");
  const boxes: Record<string, Record<string, { x: number; y: number; w: number; h: number }>> = existsSync(boxFile) ? JSON.parse(readFileSync(boxFile, "utf8")) : {};
  const failures: string[] = [];
  const taken: { article: string; file: string; alt: string }[] = [];
  for (const shot of shots) {
    // Another site (Safe Voice) gets a clean browser: no sign-in, so no ELEVATE cookie can reach it
    const clean = shot.anonymous ? await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" }) : null;
    const page = await (clean ?? (await contextFor(shot.role))).newPage();
    try {
      if (shot.viewport) await page.setViewportSize(shot.viewport);
      const url = typeof shot.path === "string" ? shot.path : await shot.path(page);
      await page.goto(url);
      await shot.ready?.(page).first().waitFor({ state: "visible", timeout: 30_000 });
      await shot.prepare?.(page);
      await page.waitForLoadState("networkidle").catch(() => {});
      await dress(page, shot.highlight?.(page) ?? []);
      await page.waitForTimeout(400);
      const found: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const [name, locate] of Object.entries(shot.targets ?? {})) {
        const box = (await locate(page).count()) ? await locate(page).first().boundingBox() : null;
        if (box && (box.width < 4 || box.height < 4)) console.log(`  note  ${shot.article}/${shot.file}: target "${name}" has no size (hidden?)`);
        else if (box) found[name] = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
        else console.log(`  note  ${shot.article}/${shot.file}: target "${name}" not found`);
      }
      boxes[`${shot.article}/${shot.file}`] = found;
      mkdirSync(path.join(ASSETS, shot.article), { recursive: true });
      await page.screenshot({ path: path.join(ASSETS, shot.article, `${shot.file}.png`) });
      taken.push({ article: shot.article, file: `${shot.file}.png`, alt: shot.alt });
      console.log(`  ok  ${shot.article}/${shot.file}`);
    } catch (error) {
      failures.push(`${shot.article}/${shot.file}: ${(error as Error).message.split("\n")[0]}`);
      console.log(`  FAILED  ${shot.article}/${shot.file}`);
    } finally {
      await page.close();
      await clean?.close();
    }
  }
  for (const context of contexts.values()) await context.close();

  writeFileSync(boxFile, `${JSON.stringify(boxes, null, 2)}
`);
  // The list of pictures taken (with their captions): a partial run updates only its own entries
  const listFile = path.join(ASSETS, "_shots.json");
  const earlier: typeof taken = existsSync(listFile) && only.length ? JSON.parse(readFileSync(listFile, "utf8")) : [];
  const merged = [...earlier.filter((e) => !taken.some((t) => t.article === e.article && t.file === e.file)), ...taken];
  writeFileSync(listFile, `${JSON.stringify(merged, null, 2)}\n`);
  if (failures.length) throw new Error(`${failures.length} screenshot(s) failed:\n${failures.join("\n")}`);
});
