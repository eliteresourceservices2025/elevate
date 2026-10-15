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
for client add-on courses. Each would be a separate decision.
