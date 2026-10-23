# 13 Recap videos (optional, one per module)

**Status:** built. Every module of the HIPAA and Cybersecurity courses has a 60 to 90 second motion-graphics recap with a
voice-over and quiet music, shown at the top of the module in the Learn player. Reading the module stays the required part.

## Decisions made with the owner (14 October 2026)

| Question | Decision |
| --- | --- |
| Purpose | An **optional recap** before each module, not a replacement for reading |
| Length | 60 to 90 seconds |
| Voice | First chosen as captions only, then **changed to a voice-over** the same day: the narration reads the on-screen words, which stay on screen as captions |
| Where | **Inside the Learn player**, at the top of each module |
| Required? | **No**: reading is required; the video is optional and counts for nothing |
| Review | No separate review step, **as long as every line matches the module's lesson text** |

## How it works

- **The storyboard is data**: `apps/learn/src/content/recaps.ts`. Each recap is a list of scenes (a statement, a list, steps,
  layers, a compare, a timeline). The same file is the source of the video, the narration and the transcript the player shows.
- **Rules (tested in `recaps.test.ts`)**: exactly one recap per module of both courses; 60 to 90 seconds as rendered
  (`recap-durations.json`, written by the renderer: the voice sets the pace); 4 to 8 scenes; at most 5 items per scene and short
  lines; no markup, identifiers or web addresses (same text checks as the lessons); the rendered file exists and is a sensible size.
- **Every line restates the lesson**: the scenes use the module's key points, tables, steps and timelines. A new fact or a legal
  claim that is not in the lessons does not belong in a recap. When a lesson changes, change its storyboard and re-render.
- **The player** (`apps/learn/src/components/recap-panel.tsx`): a collapsed "Optional: watch a N-second recap" panel under the
  module title with the video (not downloaded until played, never autoplays) and "Read the recap as text". The course address and
  module key choose the recap (`getModuleView` returns `courseSlug`; `findRecap(course, module)`). The Course studio preview shows
  it too. Time spent on the video is not counted toward the module's minimum reading time.
- **Hosting**: the MP4 files are `apps/learn/public/recaps/<course>-<module>.mp4`, served from the app's own origin (the content
  security policy already allows `media-src 'self'`; no third-party player, no tracking). The files are not secret: they restate
  lesson text and are reachable by address without signing in.
- **A client add-on course has no recap** (the panel simply does not appear).

## The voice and the music

- **Voice**: a Windows text-to-speech voice (Microsoft Zira, through System.Speech, offline), made by `tools/recap-video/narrate.cjs`
  and `speak.ps1`. Acronyms are spelled out for the voice (for example "H H S"). It is a synthetic voice: clear, but not a
  person. A recorded voice can replace it: put WAV files named `intro.wav`, `s1.wav` ... `outro.wav` in the module's folder under
  `tools/recap-video/audio/<voice>/<course>-<module>/` and render again.
- **Music**: original and generated in code (`tools/recap-video/music.cjs`: simple chords from sine and triangle waves), so it has no
  license or attribution. Put your own `music.wav` in the audio folder to use a track you own.
- **Timing**: each scene is stretched so the voice always finishes before the scene ends.

## Re-rendering

The renderer is in `tools/recap-video` (Remotion, React to MP4). It is **not part of the pnpm workspace**, so it adds no
dependency to the apps. Needs Chrome (set `CHROME_PATH` if it is not in the usual place) and Windows (the voice).

```bash
pnpm --filter elevate learn:export-recaps         # writes tools/recap-video/recaps.json from recaps.ts
cd tools/recap-video && npm install               # once
node narrate.cjs "Microsoft Zira Desktop" hipaa/associates ...   # the voice and the timing, for each module you changed
node render.cjs --data recaps.zira.json --audio audio/zira       # narrated, all (about 4 to 5 minutes each); add --skip-existing to resume
node stills.cjs hipaa/associates                  # a still from every scene, to look at the result
```

Output is 1280 x 720, 30 frames per second, H.264 with AAC audio, under 1 MB per video. Commit the changed MP4 files and
`recap-durations.json` with the storyboard change.

## Not built

A recorded human voice (the pipeline accepts one), a video block inside lesson screens, a per-person "watched" record, or recaps
for client add-on courses (those are written in the studio, so a video would need an in-studio storyboard and a hosted render step). Each would be a separate decision.

Recaps are tied to a course version: `RECAP_FROM_VERSION` in `recaps.ts` is the first version number whose lessons a course's recaps were written for, and a person on an older version is offered none. Raise it when a lesson change makes a recap's words wrong for earlier versions.

## Customer Service Excellence videos (executive review, not in the app)

HR proposed a Customer Service & Family Support Excellence course (`Elite - CS Upskilling.pptx`). Until the executives approve it,
there is **no course in Learn**: only 14 narrated motion-graphic videos, one per topic of the deck, made with the same renderer.
Nothing here touches `apps/learn`, `recaps.ts` or `recaps.json`.

- **Decisions (owner, 21 October 2026):** videos only; about one video per topic, 60 to 90 seconds each; mostly graphics, few words;
  the voice is Zira; mock calls and "instead of / say" examples are animated chat bubbles with Zira reading both sides (two pitches).
  The three mock calls are one video each, because together they do not fit in 90 seconds (14 videos, not 12).
- **Storyboards:** `tools/recap-video/customer-service/storyboards.cjs` (data; slide numbers per video). Scene kinds: hero, icons, formula,
  flow, swap, dialogue, checklist, compare, drawn by `src/Cs.jsx` (icons from lucide, generated into `src/icons.js` by `gen-icons.cjs`).
  On screen: icons, cards and a few words. The detail is in the narration (`say`); the full text is in `out/customer-service/transcripts.md`.
- **Every line restates the deck.** No new facts. Caveats stay ("only when the timeline is confirmed", "no private information until
  verified"). A line that is not in the deck does not belong in a storyboard.
- **Timing:** `narrate-cs.cjs` speaks every piece separately, joins a scene's pieces with short pauses and records when each starts,
  so a picture appears when its words start. It prints each video's length and flags any outside 60 to 90 seconds.

```bash
cd tools/recap-video && npm install                       # once
node customer-service/narrate-cs.cjs                      # voice, timing, music, transcripts (all, or give video ids)
node customer-service/render-cs.cjs                       # MP4s into out/customer-service (add --skip-existing to resume)
node customer-service/render-cs.cjs --stills cs-01-our-role   # a still from every scene, to look at the result
```

Output is not committed (`out/` is ignored) while the videos are in review. If the course is approved, bringing it into Learn is a
separate piece of work: the lesson text, the course, moving the storyboards into `recaps.ts` and re-rendering into `apps/learn/public/recaps`.

## HIPAA and Cybersecurity animated videos (in the app, version 3 onward)

The HIPAA recaps are animated (icons, chains, count-up numbers, timelines, stacks), narrated in the owner's cloned voice (VoiceStudio) with the licensed lofi track, with **optional English subtitles** (WebVTT, a CC button in the player; they are not burned in). They are **private**: files live in `apps/learn/media/recaps` and are served only to signed-in people by `/api/recaps/<file>`; the player has no download button, right-click menu or picture-in-picture (`protected-video.tsx`). That keeps casual copying away; anyone who can play a video can still record their screen.

- **Storyboards:** `tools/recap-video/learn/storyboards-hipaa-a.cjs` and `-b.cjs` (data, one per module; Cybersecurity follows after its content update). Scene kinds: the Customer Service ones plus `stat`, `chain`, `timeline`, `stack` (`src/LearnScenes.jsx`). Every spoken line (`say`) restates the lesson: no new facts. `node learn/validate.cjs hipaa` checks kinds, icons and the 60 to 90 second estimate.
- **Make them** (VoiceStudio open on port 3900): `node learn/narrate-learn.cjs hipaa` (voice, timing, `recap-spoken.json` for "Read the recap as text"), then `node learn/render-learn.cjs hipaa` (mp4 and vtt into `apps/learn/media/recaps`, lengths into `recap-durations.json`, subtitles into `recap-captions.json`). Both accept video ids to redo one video. Lines are cached, so an interrupted run resumes.
- **Music:** `audio/cs/bgm.mp3` (git-ignored; keep the licensed file safe) mixed at 0.12.
- **Version:** `RECAP_FROM_VERSION` for HIPAA is 3.
- This section supersedes the Zira and generated-music notes above for the Customer Service videos too: they now use the same voice and track.

## Customer Service lesson videos (where they play, how to make them)

- **Where they play:** `apps/learn/src/content/customer-service/videos.ts` (welcome on the course page, lesson videos at the top of each module, three worked
  example calls above the mock call). They are optional; reading stays the required part. Served only to a signed-in person from
  `apps/learn/media/recaps`, with no download button (`protected-video.tsx`).
- **Make them** (VoiceStudio open): storyboards are `tools/recap-video/customer-service/{storyboards,welcome-storyboard,modules-storyboard,demos-storyboard}.cjs`.
  `node customer-service/narrate-welcome.cjs --set modules --speed 1.35` (or `--set demos`), then `CS_SET=modules node customer-service/render-welcome.cjs`
  (the deck videos use `narrate-cs.cjs` and `render-cs.cjs`), then `node customer-service/export-to-learn.cjs` copies the MP4s and writes `videos.json`.
- **Subtitles are burned into the picture** (`captions.cjs`, from the same words and timings as the voice); no separate subtitle track is offered.
- **Held back:** the three deck mock calls (cs-11 to cs-13) sat too close to the graded mock call (one repeats a graded caller line), so the worked examples
  (cs-d1 to cs-d3, different callers and situations) replace them. Do not show a model answer to a graded scenario.
