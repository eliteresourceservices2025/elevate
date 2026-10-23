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
- The guides are grouped in topics (`categories.ts`). Four topics are for everyone and describe what a person does for themselves: **Your time and clock**, **Your profile and documents**, **Training and growth** and **Privacy and speaking up**. The others are for HR, leads and recruiters; each guide's `audience` decides who sees it.
- The Employee pictures are taken as "Joy Villanueva" and rely on demo data made in `demo-data.ts`: a client, a schedule, two prize days, a certificate, a laptop, an onboarding checklist, an announcement to acknowledge, and a review template for launching a cycle. The announcement and the checklists are made through the real screens, because a row inserted by SQL has no recipients and nobody would be asked to acknowledge it.
- **Safe Voice is a separate site** (`apps/safe-voice`). Start it (`pnpm --filter safe-voice dev`, port 3100, or set `SAFEVOICE_URL`) before taking the pictures of the `report-something-anonymously` guide. Those two pictures are taken in a clean browser with no sign-in, so no ELEVATE cookie reaches it. The Safe Voice handler guide has no pictures: only named handlers see those screens.
- `HELP_ONLY=invite-a-person,post-a-job pnpm help:shots` takes only those guides' pictures. If your dev server already runs, `E2E_BASE_URL=http://localhost:3000`.
- **After any change to a screen a guide shows, run the tool again and read the guide.** The guide text names real buttons: when a label changes, the guide must change with it.

## Narrated videos (`tools/recap-video/howto/`)
Short how-to videos (one to two minutes) made from the screenshots, with a voice-over and on-screen captions. Self-contained: it shares no code with the Learn recap videos.
- `storyboards.cjs` is the script: for each video a list of steps, each with the picture, the part of it to zoom to (a target name from `tests/help/shots.ts`), a short caption and the words the voice says. The guide's header carries `video: <id>` and the file is `content/help/videos/<id>.mp4`, served by the signed-in route with the guide's audience.
- First time: `npm install` in `tools/recap-video` (it is not part of the pnpm workspace). A video that already exists is only rebuilt when you run it without `--skip-existing`: nothing checks whether the pictures or the storyboard changed since.
- `node howto/build.cjs [ids]` (from `tools/recap-video`) speaks the text (Windows voice "Microsoft Zira Desktop", offline; only changed lines are spoken again), then renders MP4s with Remotion and Chrome. `--stills` writes one picture per scene to `howto/.build/stills` to check the look; `--no-render` only makes the voice. Windows only.
- The zoom positions come from `content/help/assets/_boxes.json`, written by `pnpm help:shots`. After a screen changes: run `pnpm help:shots`, then `node howto/build.cjs`, and re-read the storyboard text against the new screen. A step whose target is missing is shown without a ring (the build warns).
- Keep the captions to what the screen says, and no client or patient information anywhere (the pictures are fake data).

## The HR training deck (`tools/training-deck/`, output `docs/training/ELEVATE-HR-training.pptx`)
One master deck in parts for teaching HR admins, team leads and recruiters: Welcome, then Part A (people, onboarding, offboarding), B (recruiting), C (time, attendance, time off), D (documents, training, reviews), E (reports, settings, speaking up), and a wrap-up with the common mistakes and a practice list. 68 slides, about 3.9 hours with discussion; each part opens with a divider so it can be taught in its own session.
- Every slide has **speaker notes**: what to say, the clicks to demonstrate, a watch-out, a question for the group, the guide to point to and the time it takes. The slide text is short on purpose; the guides and videos carry the detail.
- `parts/*.cjs` hold the slide content (plain data); `build.cjs` makes the deck with pptxgenjs, with the brand theme (purple and gold, Cambria and Calibri), one section per part, and the Help center pictures cropped and given rounded corners. A slide names its picture as `<guide>/<file>` (from `content/help/assets`) and may name a target to centre a tall picture on.
- First time: `npm install` in `tools/training-deck` (not part of the pnpm workspace). Then `node build.cjs`. **After a screen changes:** run `pnpm help:shots`, then `node build.cjs`, then re-read the slide text against the new screen (the slide steps name real buttons).
- To look at the result: open it in PowerPoint, or export the slides to PNG with PowerPoint and run `node sheets.cjs` for contact sheets of four slides each (`.build/sheets`).
- **VA and contractor deck:** `node build.cjs va` writes `docs/training/ELEVATE-VA-training.pptx` (31 slides, about 1.7 hours): Welcome (two-step sign-in, menu, three rules), A Your time, B Your profile, C Training and growth, D Privacy and speaking up, wrap-up. It uses only the guides whose audience is `all`. `node build.cjs` (or `hr`) writes the HR deck. Decks are listed in `DECKS` in `build.cjs`; a new deck is a new entry plus its `parts/` files. Both `.pptx` files are git-ignored (`docs/**/*.pptx`): rebuild them, do not look for them in git.

## Not built yet
Links between guides (they refer to each other by title), videos for the other guides.
