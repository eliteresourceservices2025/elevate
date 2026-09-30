import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, signInEnrollingMfa } from "./helpers";

// Runs in its own Playwright project AFTER everything else (see playwright.config.ts): while a privacy notice
// is published, every signed-in person is stopped at the acceptance screen, which would break other tests.
// The notice is archived again at the end, which switches the gate off.

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>) {
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

test("a person must accept the published privacy notice before using ELEVATE", async ({ page }) => {
  const stamp = Date.now();
  const employee = await createEmployeeAccount("Gia", `Gate${stamp}`);
  await signInEnrollingMfa(page, employee); // no notice is published yet: straight to the dashboard
  await expect(page.getByRole("heading", { name: "Welcome to ELEVATE" })).toBeVisible();

  try {
    await withSql(async (sql) => {
      const [policy] = await sql<{ id: string }[]>`select id from docs.policies where kind = 'privacy_notice'`;
      await sql`update docs.policies set archived_at = null where id = ${policy.id}`;
      await sql`
        insert into docs.policy_versions (policy_id, version, body, status, requires_ack, published_by, published_at)
        select ${policy.id}, coalesce(max(version), 0) + 1, ${`# E2E privacy notice ${stamp}\n\nWe keep your data safe.`}, 'published', true, ${randomUUID()}, now()
        from docs.policy_versions where policy_id = ${policy.id}`;
    });

    // The gate replaces every page until the notice is accepted
    await page.goto("/people");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: `E2E privacy notice ${stamp}` })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0); // no menu, no way around it
    await page.goto("/my-data");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();

    await page.getByRole("button", { name: "I have read and understand" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toHaveCount(0);

    // Accepted: the app opens, and the acceptance is on My data
    await page.goto("/my-data");
    await expect(page.getByRole("heading", { level: 1, name: "My data" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Announcements and policies you acknowledged" }).getByText("Privacy notice")).toBeVisible();
  } finally {
    await withSql((sql) => sql`update docs.policies set archived_at = now() where kind = 'privacy_notice'`);
  }
});
