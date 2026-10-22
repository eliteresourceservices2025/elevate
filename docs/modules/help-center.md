# Help center and the screenshot tool

> Notes for `apps/elevate/src/modules/help/`, `apps/elevate/content/help/` and `apps/elevate/tests/help/`. Read before changing the guides or the tool.

## What it is
`/help` is a plain-English knowledge base for people who are not technical: topics, search and short step-by-step guides with pictures (videos come later). The menu item is **Help center** under Learning. Permission `help.view` is open to every role; **which guides a person sees is decided by the guide's own `audience`**.

## The guides are files
- `apps/elevate/content/help/<category>/<slug>.md`. The header between two `---` lines is read by `frontmatter.ts` (Zod): `title`, `summary`, `category` (a slug from `categories.ts`), `audience` (`all`, or a comma list of roles), `order`, optional `video` (a name in `content/help/videos`, no `.mp4`), `updated`.
- The body is the app's safe Markdown (`src/lib/markdown.ts`: no HTML). One extra line is allowed, a picture from the help folder: `![What it shows](help:<slug>/01-name.png)`. The path is checked (`body.ts`, `isSafeAssetPath`): letters, numbers, `-`, `_`, `/`, a picture extension, no `..`.
- Use `#` for section headings (it renders as h2, the first level under the page title). A `##` would render as h3 and skip a level.
- Write for non-technical readers: short sentences, the real names of buttons and tabs in **bold**, no jargon, a "Common mistakes" and a "Try it yourself" section. Never put client or patient information, real names or real emails in a guide or a picture.
- A guide that names another guide uses its exact title in quotes (a test-free convention; check by hand).

## Who can open what
- `content.ts` filters by audience on every read (`listHelpArticles`, `getHelpArticle`, `searchHelp`, `visibleCategories`), so a hidden guide is a 404, in its title too (the page's `generateMetadata` uses the same filter).
- Pictures and videos are not in `public/`: `/api/help/[folder]/[...path]` serves them to signed-in people only after the same audience check (`mayOpenHelpFile`; a picture belongs to the guide named by its first folder, a video to the guide whose header names it). Videos honour Range requests. `next.config.ts` ships `content/help` with those routes (`outputFileTracingIncludes`); this was not verified with a production build, so check it on the first deploy.
- Tests: `help.test.ts` (header, picture paths, every real guide has a valid header and existing pictures and no non-example email), `content.test.ts` (audience on the real guides, the file guard), the `help.view` row in `tests/authz/matrix.test.ts`.

## The screenshot tool (`pnpm help:shots`)
Takes every picture the guides use, as the right role would see the screen, from the **local** database only (it uses the e2e helpers, which refuse anything else).
- `tests/help/shots.ts` lists the pictures: guide name, file name, whose view, address, optional steps (open a dialog), and gold frames to draw around what the reader must click. Pictures are saved to `content/help/assets/<guide>/<file>.png`.
- `tests/help/accounts.ts` makes one fake account per role with natural names (Maria Santos is HR, Ana Reyes is Super Admin and so on). Safe to run again.
- `tests/help/demo-data.ts` fills the empty screens with invented data: jobs and applicants, last week's hours (a few with flags), time-off and extra-hours requests, support requests. Onboarding and offboarding cases are started through the real screens.
- Run on a freshly reset local database for consistent pictures: `supabase db reset --workdir ../..` (from `apps/elevate`, with `pnpm exec`), then `pnpm db:migrate`, `pnpm db:seed`, `pnpm storage:setup`, then `pnpm help:shots`. Without a reset the People list shows the "E2E" people the end-to-end tests leave behind.
- `HELP_ONLY=invite-a-person,post-a-job pnpm help:shots` takes only those guides' pictures. If your dev server already runs, `E2E_BASE_URL=http://localhost:3000`.
- **After any change to a screen a guide shows, run the tool again and read the guide.** The guide text names real buttons: when a label changes, the guide must change with it.

## Not built yet
Videos (planned: narrated walkthroughs with `tools/recap-video`), the PowerPoint, guides for VAs and contractors, links between guides (they refer to each other by title).
