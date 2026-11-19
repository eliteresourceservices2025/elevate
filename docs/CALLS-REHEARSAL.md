# Calls rehearsal with real people

What the automated tests cannot tell us: how calls behave on real computers, real home internet, real headsets and real Cloudflare. Run this before announcing calls, in two rounds. Fake-camera tests passed for 2 to 6 people on one machine; a real 25-person meeting, a 125-person all-hands, recording on a real network and the new microphone/camera picker on real devices are **not yet confirmed**.

Setup (once, by whoever runs the rehearsal):

- Production (or a staging copy) has the four `CLOUDFLARE_*` settings and the latest migrations (see `PRODUCTION-CHECKLIST.md`, "Calls go-live"). Settings > Calls shows no "Calls are off" notice.
- Open Cloudflare's dashboard > Realtime and note the usage for the month before you start (write the number down).
- One person is the **host** (HR, Executive or Super Admin) and one person writes notes. Everyone else just follows the steps.
- Ask everyone to use their normal computer, headset and internet (some on a phone hotspot, some on Wi-Fi far from the router, at least two from the Philippines and two from the US if possible).

## Round 1: a meeting of 10 to 25 (30 minutes)

Create a group chat with everyone and start a call from it. Each person follows the checklist and replies in the call chat with "done" or what went wrong.

| # | Step | Passes when | Note |
|---|------|-------------|------|
| 1 | Ring: the host presses Start a call | Everyone sees the pop-up within 5 seconds and the tab title flashes; the ring only starts after the host is inside | Time it; list who did not see it |
| 2 | Lobby: choose a microphone and camera, press "Test my microphone and camera" | The meter moves when you talk; your picture shows; the names of your devices appear | Note headsets and cameras that do not show up |
| 3 | Join with the microphone on | Everyone hears the host within 3 seconds, nobody hears an echo | Echo usually means speakers instead of a headset |
| 4 | Everyone turns the camera on, one by one | Each person sees about 9 faces; the rest are name circles; pages work | Note anyone stuck on a black tile for more than 10 seconds |
| 5 | Switch microphone during the call (More > Devices) | The others still hear you; no break longer than 2 seconds | Try the laptop microphone and a headset |
| 6 | Switch the camera and the speakers the same way | Same | |
| 7 | One person shares a window (not the whole screen) | Everyone sees it within 10 seconds without refreshing | Note anyone who needed a refresh |
| 8 | Chat in the call and react with the emojis | Messages and reactions show for everyone within 3 seconds; the Chat button shows a count when closed | The same messages are in the group chat afterwards |
| 9 | Raise a hand, mute and unmute, the host mutes someone | The icons show; the muted person is told | |
| 10 | Someone leaves and rejoins; someone closes the tab without leaving | The rejoin works; the closed tab disappears from the list within 90 seconds | |
| 11 | The host presses End for everyone | A question appears first; after confirming everyone is out and the chat says the call ended | |

Write down for the whole call: the biggest delay anyone saw, who had choppy sound or picture, and how many people each person could see.

## Round 2: an all-hands (30 minutes, ideally 100 or more people)

Use the company chat (or a big group). The host starts an all-hands.

- Everyone joins and watches. The host and two speakers talk. Check that **the audience hears and sees the speakers** within 5 seconds and that joining 100 people does not freeze the host's screen (note the biggest lag).
- 20 people raise a hand at once and 20 send a reaction: do they show for the host within 5 seconds, and does the page stay smooth?
- The host makes a person a speaker, then puts them back. The speaker can talk and then cannot.
- Questions go in the call chat; the host answers them.
- At the end note Cloudflare's usage again. Compare with **Settings > Calls** (our estimate for the all-hands) and with the number you wrote down at the start. If the real figure is more than twice our estimate, change `GB_PER_PARTICIPANT_HOUR` in `src/modules/calls/usage.ts`.

## Recording check (only after the policy is published and counsel agrees; see the go-live checklist)

A Super Admin picks one recorder and switches recording on.

1. The recorder starts recording in a small meeting of 4 people. Each person must be asked yes or no.
2. Two say yes, one says no, one never answers. Talk for two minutes, everyone in turn.
3. Stop. Open Messages > Call recordings as each person: the recording is there for everyone who was in the call and plays. Only the two who said yes should be audible and visible in it; the other two must be absent.
4. Someone who was NOT in the call must see nothing at Messages > Call recordings.
5. Check the recorder kept the tab open and visible: if they switched tabs the picture may freeze (the sound should not).

## Pass marks before announcing

- Round 1: at least 90% of steps pass for at least 90% of people; every failure has a note; nobody needs a refresh to see a shared screen.
- Round 2: the audience hears the speakers; no freeze for the host; the usage is within our estimate or the estimate is corrected.
- Recording (if used): the two who said no are not in the file.

## Reporting

For each problem write: who (their computer, browser, headset, country), what they did, what they saw, how long it lasted. Send them to the person who built this; the most useful extra detail is a screenshot of the browser's console (F12 > Console) at the time.
