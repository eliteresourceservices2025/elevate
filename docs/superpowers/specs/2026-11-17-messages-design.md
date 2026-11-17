# ELEVATE Messages (chat first, calls second): design

Status: approved by the owner on 2026-11-17 (plan and clickable prototype). Prototype: https://claude.ai/artifact/SaDLNSUTBLuwHPJBZUEEQn

## Intent

The executives and the internal team asked for chat and video calls inside ELEVATE. People use scattered free tools today (Messenger, Viber, personal Meet), which ERS cannot control or keep. One company-controlled place replaces them for internal talk. **Chat is the main feature; calls are secondary.** Free and open-source tools first; pay only when truly needed.

## Goals

- Direct messages, private groups, team channels (kept in sync with ELEVATE teams), company and department channels, threaded replies.
- Emoji, GIFs (KLIPY through our server), files and images, voice notes, polls, pinned messages, message search.
- Client contacts join as **guests** in client groups for attendance matters.
- Calls: 1:1, group, and a 125+ all-hands; everyone may share their screen; recording only by people a Super Admin picks, with everyone's consent.
- New monthly cost: $0 at our volume (ceiling about $20 for overages).

## Non-goals and anti-goals

- No phone-number calling (no SIP). No call recording in calls that include a client. No bots, transcription or AI notetakers.
- Never a way for HR or anyone to read chats casually. Never message text in email, notifications, audit rows, Sentry or Realtime payloads.
- Not a client-records channel: patient details are forbidden (see Constraints).

## Constraints (owner decisions, 2026-11-17)

- **Clients (outsiders):** allowed, for attendance matters only, under a written "never share patient details in ELEVATE" rule. No vendor BAAs (the owner accepted this). This relaxes the CLAUDE.md "no patient data" rule for the Messages module only: it stays "no fields for patient data", and chat is free text guarded by warnings and the guest notice.
- **HR reading a chat:** only through a logged request an HR Admin makes and a *different* Super Admin approves; read-only, the requested dates only, 72 hours, every page read audited.
- **Recording:** a per-person flag set by a Super Admin (`can_record_calls`, like `payroll_access`), company switch off by default, consent from everyone in the call.
- **Free tiers:** rate-limit messages in Postgres (Upstash free tier is 500K commands a month); chat emails are the lowest priority (Brevo is 300 a day); no job runs more often than every 30 minutes (Inngest).
- **Policy gates:** monitoring policy v2 and a privacy notice entry (the notice is already over its 10,000-character limit) must be published before real people use it; retention periods wait for counsel.

## Approaches considered

1. **Cloudflare Realtime SFU for calls (chosen).** $0 up to 1,000 GB a month, no server to run; we build signaling and screens. Fallback: self-hosted LiveKit (open source), behind one adapter file.
2. LiveKit Cloud (about $70 a month): fastest to build, but a recurring cost the owner wants to avoid.
3. Peer-to-peer (PeerJS, simple-peer): free, but breaks above 4 to 6 people, so no all-hands.

For live chat delivery: **Supabase Realtime private channels carrying ids only** (chosen) versus polling only (too slow and too many requests) versus a self-run websocket server (a server to maintain).

## Architecture (summary; full detail in the approved plan)

- Message text is encrypted at rest (`fieldCrypto`, context `chat_message:<conversationId>:<messageId>`) and never travels over Realtime. After saving, the server broadcasts `{type, conversationId, messageId}` on private channels `conv:<id>` and `user:<id>`; the browser then calls a server action that checks membership and decrypts.
- Private channels are authorized by one RLS policy on `realtime.messages` that calls `chat.can_join(topic, uid)`. App tables keep RLS with no policies. This is a documented exception to CLAUDE.md rule 3.
- New Postgres schema `chat` (migration 0146 onward). Module `src/modules/messages/` with the standard files.
- Guests are a new role added in Phase 3 (a 7th column in the authz matrix).
- Calls (Phase 4+) use Cloudflare SFU and TURN through `calls/transport.ts`, the only file that knows the provider.

## Phases

0 Design prototype and docs, 1 chat core, 2 rich chat, 3 guests, 4 calls, 5 all-hands and recording, 6 HR access requests, 7 rollout and pilot. Phase 1 plan: `docs/superpowers/plans/2026-11-17-messages-phase-1-chat-core.md`.

## Decisions left to the builder

- Exact visual details inside the prototype's look; wording of empty states and errors (plain, short, sentence case).
- My calls in Phase 1 (marked for the owner to check): message order uses an identity `seq` column instead of uuid v7; a message edit window is unlimited but marked "edited"; deleting a message keeps the row (`deleted_at`) and shows a tombstone.
